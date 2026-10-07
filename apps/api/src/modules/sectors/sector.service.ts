import { withTenantTransaction } from "../../db.js";
import { isSectorManager, isTenantAdmin } from "../../authorization.js";
import { canEnableAnotherSector } from "../billing/billing.service.js";

export type MembershipRole = "MANAGER" | "APPROVER" | "MEMBER";

export async function listSectors(tenantId: string) {
  return withTenantTransaction(tenantId, async (client) => {
    const result = await client.query(
      `SELECT id, name, active, created_at
         FROM sectors
        ORDER BY active DESC, name ASC`,
    );

    return result.rows;
  });
}

export async function createSector(input: {
  tenantId: string;
  actorUserId: string;
  name: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await isTenantAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const entitlement = await canEnableAnotherSector(client, input.tenantId);
    if (!entitlement.allowed) {
      return {
        kind: "plan_limit" as const,
        reason: entitlement.reason,
        ...("limit" in entitlement ? { limit: entitlement.limit } : {}),
        ...("activeSectors" in entitlement ? { activeSectors: entitlement.activeSectors } : {}),
      };
    }

    const result = await client.query<{ id: string; name: string }>(
      `INSERT INTO sectors (tenant_id, name)
       VALUES ($1, $2)
       RETURNING id, name`,
      [input.tenantId, input.name],
    );

    const sector = result.rows[0]!;

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'SECTOR_CREATED', 'sector', $3, $4::jsonb)`,
      [input.tenantId, input.actorUserId, sector.id, JSON.stringify({ name: sector.name })],
    );

    return { kind: "created" as const, sector };
  });
}

export async function addSectorMember(input: {
  tenantId: string;
  actorUserId: string;
  sectorId: string;
  userId: string;
  role: MembershipRole;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const sectorResult = await client.query<{ active: boolean }>(
      `SELECT active FROM sectors WHERE id = $1`,
      [input.sectorId],
    );

    const sector = sectorResult.rows[0];
    if (!sector) return { kind: "sector_not_found" as const };
    if (!sector.active) return { kind: "sector_inactive" as const };

    const actorIsAdmin = await isTenantAdmin(client, input.tenantId, input.actorUserId);
    const actorIsManager = await isSectorManager(client, input.sectorId, input.actorUserId);

    if (!actorIsAdmin && !actorIsManager) {
      return { kind: "forbidden" as const };
    }

    if (input.role === "MANAGER" && !actorIsAdmin) {
      return { kind: "cannot_grant_manager" as const };
    }

    const tenantUser = await client.query(
      `SELECT 1
         FROM tenant_users
        WHERE tenant_id = $1
          AND user_id = $2
          AND active = true
        LIMIT 1`,
      [input.tenantId, input.userId],
    );

    if (tenantUser.rowCount !== 1) {
      return { kind: "user_not_in_tenant" as const };
    }

    const result = await client.query(
      `INSERT INTO memberships (tenant_id, sector_id, user_id, role, active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (tenant_id, sector_id, user_id)
       DO UPDATE SET role = EXCLUDED.role, active = true
       RETURNING id, sector_id, user_id, role, active`,
      [input.tenantId, input.sectorId, input.userId, input.role],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'SECTOR_MEMBER_UPSERTED', 'membership', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        result.rows[0].id,
        JSON.stringify({
          sectorId: input.sectorId,
          userId: input.userId,
          role: input.role,
        }),
      ],
    );

    return { kind: "saved" as const, membership: result.rows[0] };
  });
}


export async function deactivateSectorMember(input: {
  tenantId: string;
  actorUserId: string;
  sectorId: string;
  userId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const membershipResult = await client.query<{
      id: string;
      role: MembershipRole;
      active: boolean;
    }>(
      `SELECT id, role, active
         FROM memberships
        WHERE sector_id = $1
          AND user_id = $2
        FOR UPDATE`,
      [input.sectorId, input.userId],
    );

    const membership = membershipResult.rows[0];
    if (!membership) return { kind: "not_found" as const };
    if (!membership.active) return { kind: "already_inactive" as const };

    const actorIsAdmin = await isTenantAdmin(client, input.tenantId, input.actorUserId);
    const actorIsManager = await isSectorManager(client, input.sectorId, input.actorUserId);

    if (!actorIsAdmin && !actorIsManager) {
      return { kind: "forbidden" as const };
    }

    if (membership.role === "MANAGER") {
      if (!actorIsAdmin) {
        return { kind: "cannot_remove_manager" as const };
      }

      const managerCount = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM memberships
          WHERE sector_id = $1
            AND role = 'MANAGER'
            AND active = true`,
        [input.sectorId],
      );

      if (Number(managerCount.rows[0]?.count ?? 0) <= 1) {
        return { kind: "last_manager" as const };
      }
    }

    await client.query(
      `UPDATE memberships
          SET active = false
        WHERE id = $1`,
      [membership.id],
    );

    const pendingRequests = await client.query<{ id: string; status: string }>(
      `UPDATE requests
          SET assigned_to = NULL,
              status = 'WAITING_REASSIGNMENT',
              updated_at = now()
        WHERE destination_sector_id = $1
          AND assigned_to = $2
          AND status IN ('OPEN', 'IN_PROGRESS', 'IN_CORRECTION')
       RETURNING id, status`,
      [input.sectorId, input.userId],
    );

    for (const request of pendingRequests.rows) {
      await client.query(
        `INSERT INTO audit_events
          (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
         VALUES ($1, $2, 'REQUEST_WAITING_REASSIGNMENT', 'request', $3, $4::jsonb, $5::jsonb)`,
        [
          input.tenantId,
          input.actorUserId,
          request.id,
          JSON.stringify({ assignedTo: input.userId }),
          JSON.stringify({
            assignedTo: null,
            status: "WAITING_REASSIGNMENT",
            reason: "MEMBER_DEACTIVATED",
          }),
        ],
      );
    }

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
       VALUES ($1, $2, 'SECTOR_MEMBER_DEACTIVATED', 'membership', $3, $4::jsonb, $5::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        membership.id,
        JSON.stringify({ active: true, role: membership.role }),
        JSON.stringify({ active: false, role: membership.role }),
      ],
    );

    return {
      kind: "deactivated" as const,
      waitingReassignmentCount: pendingRequests.rowCount ?? 0,
    };
  });
}


export async function deactivateSector(input: {
  tenantId: string;
  actorUserId: string;
  sectorId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await isTenantAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const sector = await client.query<{ id: string; active: boolean }>(
      `SELECT id, active FROM sectors WHERE id = $1 FOR UPDATE`,
      [input.sectorId],
    );
    const current = sector.rows[0];
    if (!current) return { kind: "not_found" as const };
    if (!current.active) return { kind: "already_inactive" as const };

    const pending = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM requests
        WHERE (origin_sector_id = $1 OR destination_sector_id = $1)
          AND status NOT IN ('CLOSED', 'CANCELLED')`,
      [input.sectorId],
    );
    const pendingCount = Number(pending.rows[0]?.count ?? 0);
    if (pendingCount > 0) {
      return { kind: "has_pending_requests" as const, pendingCount };
    }

    await client.query(
      `UPDATE sectors SET active = false WHERE id = $1`,
      [input.sectorId],
    );
    await client.query(
      `UPDATE memberships SET active = false WHERE sector_id = $1`,
      [input.sectorId],
    );
    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'SECTOR_DEACTIVATED', 'sector', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        input.sectorId,
        JSON.stringify({ active: false }),
      ],
    );

    return { kind: "deactivated" as const };
  });
}


export async function listSectorMembers(input: {
  tenantId: string;
  actorUserId: string;
  sectorId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const actorIsAdmin = await isTenantAdmin(client, input.tenantId, input.actorUserId);
    const actorIsManager = await isSectorManager(client, input.sectorId, input.actorUserId);
    const actorIsMember = await client.query(
      `SELECT 1
         FROM memberships
        WHERE sector_id = $1
          AND user_id = $2
          AND active = true
        LIMIT 1`,
      [input.sectorId, input.actorUserId],
    );

    if (!actorIsAdmin && !actorIsManager && actorIsMember.rowCount !== 1) {
      return { kind: "forbidden" as const };
    }

    const result = await client.query(
      `SELECT
          m.id, m.user_id, u.name, u.email, m.role, m.active, m.created_at
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.sector_id = $1
        ORDER BY m.active DESC, m.role, u.name`,
      [input.sectorId],
    );

    return { kind: "ok" as const, members: result.rows };
  });
}
