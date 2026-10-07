import { withTenantTransaction } from "../../db.js";
import { isActiveSectorMember } from "../../authorization.js";

export async function createRequest(input: {
  tenantId: string;
  actorUserId: string;
  originSectorId: string;
  destinationSectorId: string;
  title: string;
  dueAt: Date;
  competence?: string;
  instructions?: string;
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
        (tenant_id, origin_sector_id, destination_sector_id, created_by, title, due_at, status, competence, instructions)
       VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $8)
       RETURNING id, origin_sector_id, destination_sector_id, created_by, assigned_to,
                 title, due_at, status, competence, instructions, created_at`,
      [
        input.tenantId,
        input.originSectorId,
        input.destinationSectorId,
        input.actorUserId,
        input.title,
        input.dueAt,
        input.competence ?? null,
        input.instructions ?? null,
      ],
    );

    const created = result.rows[0];

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'REQUEST_CREATED', 'request', $3, $4::jsonb)`,
      [input.tenantId, input.actorUserId, created.id, JSON.stringify(created)],
    );

    return { kind: "created" as const, request: created };
  });
}
