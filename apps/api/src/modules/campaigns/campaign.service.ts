import { withTenantTransaction } from "../../db.js";
import { isActiveSectorMember, isSectorManager } from "../../authorization.js";

export async function createCampaign(input: {
  tenantId: string;
  actorUserId: string;
  originSectorId: string;
  destinationSectorIds: string[];
  templateVersionId?: string;
  title: string;
  competence?: string;
  dueAt: Date;
  instructions?: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await isActiveSectorMember(client, input.originSectorId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const destinations = [...new Set(input.destinationSectorIds)].filter(
      (id) => id !== input.originSectorId,
    );
    if (destinations.length === 0) return { kind: "no_destinations" as const };

    const valid = await client.query<{ id: string }>(
      `SELECT id
         FROM sectors
        WHERE id = ANY($1::uuid[])
          AND active = true`,
      [destinations],
    );
    if (valid.rowCount !== destinations.length) return { kind: "invalid_destination" as const };

    if (input.templateVersionId) {
      const template = await client.query(
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
      if (template.rowCount !== 1) return { kind: "invalid_template" as const };
    }

    const campaign = await client.query<{ id: string }>(
      `INSERT INTO campaigns
        (tenant_id, origin_sector_id, template_version_id, title, competence,
         due_at, instructions, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        input.tenantId,
        input.originSectorId,
        input.templateVersionId ?? null,
        input.title,
        input.competence ?? null,
        input.dueAt,
        input.instructions ?? null,
        input.actorUserId,
      ],
    );
    const campaignId = campaign.rows[0]!.id;
    const requestIds: string[] = [];

    for (const destinationSectorId of destinations) {
      const duplicate = input.competence
        ? await client.query(
            `SELECT 1
               FROM requests
              WHERE origin_sector_id = $1
                AND destination_sector_id = $2
                AND competence = $3
                AND title = $4
                AND status <> 'CANCELLED'
              LIMIT 1`,
            [input.originSectorId, destinationSectorId, input.competence, input.title],
          )
        : null;

      if (duplicate?.rowCount === 1) continue;

      const request = await client.query<{ id: string }>(
        `INSERT INTO requests
          (tenant_id, origin_sector_id, destination_sector_id, created_by, title,
           due_at, status, competence, instructions, template_version_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $8, $9)
         RETURNING id`,
        [
          input.tenantId,
          input.originSectorId,
          destinationSectorId,
          input.actorUserId,
          input.title,
          input.dueAt,
          input.competence ?? null,
          input.instructions ?? null,
          input.templateVersionId ?? null,
        ],
      );
      const requestId = request.rows[0]!.id;
      requestIds.push(requestId);

      await client.query(
        `INSERT INTO campaign_requests
          (tenant_id, campaign_id, request_id, destination_sector_id)
         VALUES ($1, $2, $3, $4)`,
        [input.tenantId, campaignId, requestId, destinationSectorId],
      );
    }

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'CAMPAIGN_CREATED', 'campaign', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        campaignId,
        JSON.stringify({ requestIds, destinations, competence: input.competence ?? null }),
      ],
    );

    return { kind: "created" as const, campaignId, requestIds };
  });
}

export async function getCampaign(input: {
  tenantId: string;
  actorUserId: string;
  campaignId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const campaign = await client.query<{
      id: string;
      origin_sector_id: string;
      title: string;
      competence: string | null;
      due_at: Date;
    }>(
      `SELECT id, origin_sector_id, title, competence, due_at
         FROM campaigns
        WHERE id = $1`,
      [input.campaignId],
    );
    const current = campaign.rows[0];
    if (!current) return { kind: "not_found" as const };

    if (!(await isActiveSectorMember(client, current.origin_sector_id, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const children = await client.query(
      `SELECT r.id, r.destination_sector_id, s.name AS destination_sector_name,
              r.status, r.assigned_to, r.due_at,
              (r.due_at < now() AND r.status NOT IN ('CLOSED', 'CANCELLED')) AS overdue
         FROM campaign_requests cr
         JOIN requests r ON r.id = cr.request_id
         JOIN sectors s ON s.id = r.destination_sector_id
        WHERE cr.campaign_id = $1
        ORDER BY s.name`,
      [input.campaignId],
    );

    return { kind: "ok" as const, campaign: current, requests: children.rows };
  });
}

export async function createRecurrence(input: {
  tenantId: string;
  actorUserId: string;
  originSectorId: string;
  destinationSectorIds: string[];
  templateVersionId?: string;
  title: string;
  instructions?: string;
  frequency: "WEEKLY" | "MONTHLY";
  nextRunAt: Date;
  dueOffsetDays: number;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await isSectorManager(client, input.originSectorId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const destinations = [...new Set(input.destinationSectorIds)].filter(
      (id) => id !== input.originSectorId,
    );
    if (destinations.length === 0) return { kind: "no_destinations" as const };

    const result = await client.query(
      `INSERT INTO recurrences
        (tenant_id, origin_sector_id, template_version_id, destination_sector_ids,
         title, instructions, frequency, next_run_at, due_offset_days, created_by)
       VALUES ($1, $2, $3, $4::uuid[], $5, $6, $7, $8, $9, $10)
       RETURNING id, frequency, next_run_at, active`,
      [
        input.tenantId,
        input.originSectorId,
        input.templateVersionId ?? null,
        destinations,
        input.title,
        input.instructions ?? null,
        input.frequency,
        input.nextRunAt,
        input.dueOffsetDays,
        input.actorUserId,
      ],
    );

    return { kind: "created" as const, recurrence: result.rows[0] };
  });
}
