import { withTenantTransaction } from "../../db.js";
import { isSectorManager, isTenantAdmin } from "../../authorization.js";

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
