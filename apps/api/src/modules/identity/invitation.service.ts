import crypto from "node:crypto";
import { pool, withTenantTransaction } from "../../db.js";
import { isSectorManager, isTenantAdmin } from "../../authorization.js";
import { hashPassword } from "./identity.service.js";
import { enqueueEmail } from "../notifications/notification.service.js";
import { config } from "../../config.js";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createInvitation(input: {
  tenantId: string;
  actorUserId: string;
  sectorId: string;
  email: string;
  role: "MANAGER" | "APPROVER" | "MEMBER";
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const admin = await isTenantAdmin(client, input.tenantId, input.actorUserId);
    const manager = await isSectorManager(client, input.sectorId, input.actorUserId);

    if (!admin && !manager) return { kind: "forbidden" as const };
    if (input.role === "MANAGER" && !admin) return { kind: "cannot_grant_manager" as const };

    const sector = await client.query<{ active: boolean }>(
      `SELECT active FROM sectors WHERE id = $1`,
      [input.sectorId],
    );
    if (!sector.rows[0]) return { kind: "sector_not_found" as const };
    if (!sector.rows[0].active) return { kind: "sector_inactive" as const };

    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await client.query(
      `UPDATE invitations
          SET revoked_at = now()
        WHERE sector_id = $1
          AND lower(email) = lower($2)
          AND accepted_at IS NULL
          AND revoked_at IS NULL`,
      [input.sectorId, input.email],
    );

    const result = await client.query<{ id: string }>(
      `INSERT INTO invitations
        (tenant_id, sector_id, email, role, token_hash, invited_by, expires_at)
       VALUES ($1, $2, lower($3), $4, $5, $6, $7)
       RETURNING id`,
      [
        input.tenantId,
        input.sectorId,
        input.email,
        input.role,
        tokenHash,
        input.actorUserId,
        expiresAt,
      ],
    );

    await enqueueEmail(client, {
      tenantId: input.tenantId,
      recipientEmail: input.email,
      subject: "[Handoff] Convite para acessar a plataforma",
      bodyText: `Você foi convidado para o Handoff. Acesse ${config.APP_BASE_URL}/invite?token=${encodeURIComponent(token)} até ${expiresAt.toISOString()}.`,
      dedupeKey: `invitation:${result.rows[0]!.id}`,
    });

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'INVITATION_CREATED', 'invitation', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        result.rows[0]!.id,
        JSON.stringify({ sectorId: input.sectorId, email: input.email.toLowerCase(), role: input.role }),
      ],
    );

    return {
      kind: "created" as const,
      invitationId: result.rows[0]!.id,
      token,
      expiresAt,
    };
  });
}

export async function acceptInvitation(input: {
  token: string;
  name: string;
  password: string;
}) {
  const tokenHash = hashToken(input.token);
  const lookup = await pool.query<{
    id: string;
    tenant_id: string;
    sector_id: string;
    email: string;
    role: "MANAGER" | "APPROVER" | "MEMBER";
    expires_at: Date;
    accepted_at: Date | null;
    revoked_at: Date | null;
  }>(
    `SELECT id, tenant_id, sector_id, email, role, expires_at, accepted_at, revoked_at
       FROM invitations
      WHERE token_hash = $1
      LIMIT 1`,
    [tokenHash],
  );

  const invitation = lookup.rows[0];
  if (
    !invitation ||
    invitation.accepted_at ||
    invitation.revoked_at ||
    invitation.expires_at.getTime() <= Date.now()
  ) {
    return { kind: "invalid_invitation" as const };
  }

  const passwordHash = await hashPassword(input.password);

  return withTenantTransaction(invitation.tenant_id, async (client) => {
    const locked = await client.query<{
      accepted_at: Date | null;
      revoked_at: Date | null;
      expires_at: Date;
    }>(
      `SELECT accepted_at, revoked_at, expires_at
         FROM invitations
        WHERE id = $1
        FOR UPDATE`,
      [invitation.id],
    );

    const current = locked.rows[0];
    if (!current || current.accepted_at || current.revoked_at || current.expires_at.getTime() <= Date.now()) {
      return { kind: "invalid_invitation" as const };
    }

    const existing = await client.query<{ id: string; password_hash: string | null }>(
      `SELECT id, password_hash FROM users WHERE lower(email) = lower($1) LIMIT 1`,
      [invitation.email],
    );

    let userId: string;
    if (existing.rows[0]) {
      userId = existing.rows[0].id;
      if (!existing.rows[0].password_hash) {
        await client.query(
          `UPDATE users
              SET name = $2, password_hash = $3, password_changed_at = now(), active = true
            WHERE id = $1`,
          [userId, input.name, passwordHash],
        );
      }
    } else {
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (email, name, password_hash, password_changed_at)
         VALUES (lower($1), $2, $3, now())
         RETURNING id`,
        [invitation.email, input.name, passwordHash],
      );
      userId = user.rows[0]!.id;
    }

    await client.query(
      `INSERT INTO tenant_users (tenant_id, user_id, role, active)
       VALUES ($1, $2, 'USER', true)
       ON CONFLICT (tenant_id, user_id)
       DO UPDATE SET active = true`,
      [invitation.tenant_id, userId],
    );

    await client.query(
      `INSERT INTO memberships (tenant_id, sector_id, user_id, role, active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (tenant_id, sector_id, user_id)
       DO UPDATE SET role = EXCLUDED.role, active = true`,
      [invitation.tenant_id, invitation.sector_id, userId, invitation.role],
    );

    await client.query(
      `UPDATE invitations SET accepted_at = now() WHERE id = $1`,
      [invitation.id],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'INVITATION_ACCEPTED', 'invitation', $3, $4::jsonb)`,
      [
        invitation.tenant_id,
        userId,
        invitation.id,
        JSON.stringify({ userId, sectorId: invitation.sector_id, role: invitation.role }),
      ],
    );

    return {
      kind: "accepted" as const,
      tenantId: invitation.tenant_id,
      userId,
      sectorId: invitation.sector_id,
      role: invitation.role,
    };
  });
}
