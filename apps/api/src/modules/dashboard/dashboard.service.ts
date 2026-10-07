import { withTenantTransaction } from "../../db.js";

export type InboxView = "assigned" | "sector" | "to_review" | "overdue";

export async function getInbox(input: {
  tenantId: string;
  userId: string;
  view: InboxView;
  limit?: number;
  offset?: number;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const result = await client.query(
      `SELECT DISTINCT
          r.id, r.title, r.status, r.due_at, r.competence,
          r.origin_sector_id, so.name AS origin_sector_name,
          r.destination_sector_id, sd.name AS destination_sector_name,
          r.assigned_to, r.created_at, r.updated_at,
          (r.due_at < now() AND r.status NOT IN ('CLOSED', 'CANCELLED')) AS overdue
       FROM requests r
       JOIN sectors so ON so.id = r.origin_sector_id
       JOIN sectors sd ON sd.id = r.destination_sector_id
       LEFT JOIN memberships mo
         ON mo.sector_id = r.origin_sector_id
        AND mo.user_id = $1
        AND mo.active = true
       LEFT JOIN memberships md
         ON md.sector_id = r.destination_sector_id
        AND md.user_id = $1
        AND md.active = true
      WHERE CASE $2
        WHEN 'assigned' THEN r.assigned_to = $1
        WHEN 'sector' THEN md.id IS NOT NULL
        WHEN 'to_review' THEN mo.id IS NOT NULL
          AND mo.role IN ('MANAGER', 'APPROVER')
          AND r.status = 'IN_REVIEW'
        WHEN 'overdue' THEN (mo.id IS NOT NULL OR md.id IS NOT NULL)
          AND r.due_at < now()
          AND r.status NOT IN ('CLOSED', 'CANCELLED')
        ELSE false
      END
      ORDER BY
        (r.due_at < now() AND r.status NOT IN ('CLOSED', 'CANCELLED')) DESC,
        r.due_at ASC,
        r.id ASC
      LIMIT $3 OFFSET $4`,
      [input.userId, input.view, input.limit ?? 50, input.offset ?? 0],
    );

    return result.rows;
  });
}

export async function getSectorMetrics(input: {
  tenantId: string;
  userId: string;
  sectorId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const access = await client.query(
      `SELECT 1 FROM memberships
        WHERE sector_id = $1 AND user_id = $2 AND active = true LIMIT 1`,
      [input.sectorId, input.userId],
    );
    if (access.rowCount !== 1) return { kind: "forbidden" as const };

    const result = await client.query<{
      total: string;
      open: string;
      overdue: string;
      in_review: string;
      in_correction: string;
      closed: string;
    }>(
      `SELECT
        count(*)::text AS total,
        count(*) FILTER (WHERE status NOT IN ('CLOSED', 'CANCELLED'))::text AS open,
        count(*) FILTER (
          WHERE due_at < now() AND status NOT IN ('CLOSED', 'CANCELLED')
        )::text AS overdue,
        count(*) FILTER (WHERE status = 'IN_REVIEW')::text AS in_review,
        count(*) FILTER (WHERE status = 'IN_CORRECTION')::text AS in_correction,
        count(*) FILTER (WHERE status = 'CLOSED')::text AS closed
       FROM requests
      WHERE origin_sector_id = $1 OR destination_sector_id = $1`,
      [input.sectorId],
    );

    const row = result.rows[0]!;
    return {
      kind: "ok" as const,
      metrics: Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, Number(value)]),
      ),
    };
  });
}
