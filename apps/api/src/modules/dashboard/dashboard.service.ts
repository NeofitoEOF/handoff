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
    const tenantRole = await client.query<{ role: string }>(
      `SELECT role FROM tenant_users WHERE user_id = $1 AND active = true LIMIT 1`,
      [input.userId],
    );
    const privileged = tenantRole.rows[0]?.role === "ADMIN" || tenantRole.rows[0]?.role === "AUDITOR";
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
        WHEN 'sector' THEN $5::boolean OR md.id IS NOT NULL
        WHEN 'to_review' THEN r.status = 'IN_REVIEW'
          AND ($5::boolean OR (mo.id IS NOT NULL AND mo.role IN ('MANAGER', 'APPROVER')))
        WHEN 'overdue' THEN ($5::boolean OR mo.id IS NOT NULL OR md.id IS NOT NULL)
          AND r.due_at < now()
          AND r.status NOT IN ('CLOSED', 'CANCELLED')
        ELSE false
      END
      ORDER BY
        (r.due_at < now() AND r.status NOT IN ('CLOSED', 'CANCELLED')) DESC,
        r.due_at ASC,
        r.id ASC
      LIMIT $3 OFFSET $4`,
      [input.userId, input.view, input.limit ?? 50, input.offset ?? 0, privileged],
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
      `SELECT 1
        WHERE EXISTS (
          SELECT 1 FROM memberships
           WHERE sector_id = $1 AND user_id = $2 AND active = true
        )
        OR EXISTS (
          SELECT 1 FROM tenant_users
           WHERE user_id = $2 AND active = true AND role IN ('ADMIN', 'AUDITOR')
        )`,
      [input.sectorId, input.userId],
    );
    if (access.rowCount !== 1) return { kind: "forbidden" as const };

    const result = await client.query<{
      total: string;
      open: string;
      on_time: string;
      overdue: string;
      assignment_overdue: string;
      execution_overdue: string;
      in_review: string;
      in_correction: string;
      closed: string;
      average_response_hours: string | null;
    }>(
      `SELECT
        count(*)::text AS total,
        count(*) FILTER (WHERE r.status NOT IN ('CLOSED', 'CANCELLED'))::text AS open,
        count(*) FILTER (
          WHERE r.status NOT IN ('CLOSED', 'CANCELLED') AND r.due_at >= now()
        )::text AS on_time,
        count(*) FILTER (
          WHERE r.due_at < now() AND r.status NOT IN ('CLOSED', 'CANCELLED')
        )::text AS overdue,
        count(*) FILTER (
          WHERE r.due_at < now()
            AND r.status NOT IN ('CLOSED', 'CANCELLED')
            AND (r.assigned_to IS NULL OR r.status = 'WAITING_REASSIGNMENT')
        )::text AS assignment_overdue,
        count(*) FILTER (
          WHERE r.due_at < now()
            AND r.status NOT IN ('CLOSED', 'CANCELLED')
            AND r.assigned_to IS NOT NULL
            AND r.status <> 'WAITING_REASSIGNMENT'
        )::text AS execution_overdue,
        count(*) FILTER (WHERE r.status = 'IN_REVIEW')::text AS in_review,
        count(*) FILTER (WHERE r.status = 'IN_CORRECTION')::text AS in_correction,
        count(*) FILTER (WHERE r.status = 'CLOSED')::text AS closed,
        round((
          avg(EXTRACT(EPOCH FROM (s.created_at - r.created_at)) / 3600)
          FILTER (WHERE r.status = 'CLOSED')
        )::numeric, 1)::text AS average_response_hours
       FROM requests r
       LEFT JOIN snapshots s ON s.request_id = r.id
      WHERE r.origin_sector_id = $1 OR r.destination_sector_id = $1`,
      [input.sectorId],
    );

    const itemResult = await client.query<{ reviewed: string; returned: string }>(
      `SELECT
        count(*) FILTER (
          WHERE i.status IN ('SUBMITTED', 'APPROVED', 'RETURNED')
        )::text AS reviewed,
        count(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM audit_events e
             WHERE e.entity_type = 'request_item'
               AND e.entity_id = i.id
               AND e.action = 'REQUEST_ITEM_RETURNED'
          )
        )::text AS returned
       FROM request_items i
       JOIN requests r ON r.id = i.request_id
      WHERE r.origin_sector_id = $1 OR r.destination_sector_id = $1`,
      [input.sectorId],
    );

    const row = result.rows[0]!;
    const reviewed = Number(itemResult.rows[0]?.reviewed ?? 0);
    const returned = Number(itemResult.rows[0]?.returned ?? 0);
    return {
      kind: "ok" as const,
      metrics: {
        total: Number(row.total),
        open: Number(row.open),
        onTime: Number(row.on_time),
        overdue: Number(row.overdue),
        assignmentOverdue: Number(row.assignment_overdue),
        executionOverdue: Number(row.execution_overdue),
        inReview: Number(row.in_review),
        inCorrection: Number(row.in_correction),
        closed: Number(row.closed),
        averageResponseHours: row.average_response_hours === null ? null : Number(row.average_response_hours),
        returnRate: reviewed === 0 ? 0 : Math.round((returned / reviewed) * 1000) / 10,
      },
    };
  });
}
