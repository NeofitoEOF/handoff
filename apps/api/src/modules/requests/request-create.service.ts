import { withTenantTransaction } from "../../db.js";
import { isActiveSectorMember } from "../../authorization.js";
import { createInAppNotification, enqueueEmail } from "../notifications/notification.service.js";

export async function createRequest(input: {
  tenantId: string;
  actorUserId: string;
  originSectorId: string;
  destinationSectorId: string;
  title: string;
  dueAt: Date;
  competence?: string;
  instructions?: string;
  templateVersionId?: string;
  retifiesRequestId?: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (input.originSectorId === input.destinationSectorId) {
      return { kind: "same_sector" as const };
    }

    const actorCanCreate = await isActiveSectorMember(
      client,
      input.originSectorId,
      input.actorUserId,
    );

    if (!actorCanCreate) {
      return { kind: "forbidden" as const };
    }

    const sectors = await client.query<{ id: string; active: boolean }>(
      `SELECT id, active
         FROM sectors
        WHERE id = ANY($1::uuid[])`,
      [[input.originSectorId, input.destinationSectorId]],
    );

    if (sectors.rowCount !== 2 || sectors.rows.some((sector) => !sector.active)) {
      return { kind: "invalid_sector" as const };
    }

    if (input.templateVersionId) {
      const templateVersion = await client.query(
        `SELECT 1
           FROM template_versions tv
           JOIN templates t ON t.id = tv.template_id
          WHERE tv.id = $1
            AND tv.status = 'PUBLISHED'
            AND t.sector_id = $2
            AND t.active = true
          LIMIT 1`,
        [input.templateVersionId, input.originSectorId],
      );
      if (templateVersion.rowCount !== 1) {
        return { kind: "invalid_template_version" as const };
      }
    }

    const duplicate = input.competence
      ? await client.query(
          `SELECT 1
             FROM requests
            WHERE destination_sector_id = $1
              AND origin_sector_id = $2
              AND competence = $3
              AND title = $4
              AND status <> 'CANCELLED'
            LIMIT 1`,
          [input.destinationSectorId, input.originSectorId, input.competence, input.title],
        )
      : null;

    if (duplicate?.rowCount === 1) {
      return { kind: "duplicate_competence" as const };
    }

    const result = await client.query(
      `INSERT INTO requests
        (tenant_id, origin_sector_id, destination_sector_id, created_by, title, due_at, status,
         competence, instructions, template_version_id, retifies_request_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $8, $9, $10)
       RETURNING id, origin_sector_id, destination_sector_id, created_by, assigned_to,
                 title, due_at, status, competence, instructions, template_version_id,
                 retifies_request_id, created_at`,
      [
        input.tenantId,
        input.originSectorId,
        input.destinationSectorId,
        input.actorUserId,
        input.title,
        input.dueAt,
        input.competence ?? null,
        input.instructions ?? null,
        input.templateVersionId ?? null,
        input.retifiesRequestId ?? null,
      ],
    );

    const created = result.rows[0];

    const managers = await client.query<{ user_id: string; email: string; name: string }>(
      `SELECT m.user_id, u.email, u.name
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.sector_id = $1
          AND m.role = 'MANAGER'
          AND m.active = true
          AND u.active = true`,
      [input.destinationSectorId],
    );

    for (const manager of managers.rows) {
      await enqueueEmail(client, {
        tenantId: input.tenantId,
        requestId: created.id,
        recipientEmail: manager.email,
        subject: `[Handoff] Nova solicitação: ${input.title}`,
        bodyText: `Uma nova solicitação foi enviada ao seu setor com prazo em ${input.dueAt.toISOString()}.`,
        dedupeKey: `request:${created.id}:opened:${manager.user_id}`,
      });
      await createInAppNotification(client, {
        tenantId: input.tenantId,
        userId: manager.user_id,
        requestId: created.id,
        type: "REQUEST_OPENED",
        title: "Nova solicitação",
        message: input.title,
      });
    }

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'REQUEST_CREATED', 'request', $3, $4::jsonb)`,
      [input.tenantId, input.actorUserId, created.id, JSON.stringify(created)],
    );

    return { kind: "created" as const, request: created };
  });
}
