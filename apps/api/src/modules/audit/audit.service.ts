import { withTenantTransaction } from "../../db.js";

async function canReadRequest(
  client: import("../../db.js").DbClient,
  requestId: string,
  userId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM requests r
       LEFT JOIN memberships mo
         ON mo.sector_id = r.origin_sector_id AND mo.user_id = $2 AND mo.active = true
       LEFT JOIN memberships md
         ON md.sector_id = r.destination_sector_id AND md.user_id = $2 AND md.active = true
       LEFT JOIN tenant_users tu
         ON tu.tenant_id = r.tenant_id AND tu.user_id = $2
        AND tu.active = true AND tu.role IN ('ADMIN', 'AUDITOR')
      WHERE r.id = $1
        AND (mo.id IS NOT NULL OR md.id IS NOT NULL OR tu.id IS NOT NULL)
      LIMIT 1`,
    [requestId, userId],
  );
  return result.rowCount === 1;
}

export async function getRequestTimeline(input: {
  tenantId: string;
  requestId: string;
  userId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await canReadRequest(client, input.requestId, input.userId))) {
      return { kind: "forbidden_or_not_found" as const };
    }

    const events = await client.query(
      `SELECT ae.id, ae.actor_user_id, u.name AS actor_name, ae.action,
              ae.entity_type, ae.entity_id, ae.before_data, ae.after_data, ae.created_at
         FROM audit_events ae
         LEFT JOIN users u ON u.id = ae.actor_user_id
        WHERE
          (ae.entity_type = 'request' AND ae.entity_id = $1)
          OR (
            ae.entity_type = 'request_item'
            AND EXISTS (
              SELECT 1 FROM request_items ri
               WHERE ri.id = ae.entity_id AND ri.request_id = $1
            )
          )
          OR (
            ae.entity_type = 'attachment'
            AND EXISTS (
              SELECT 1 FROM attachments a
               WHERE a.id = ae.entity_id AND a.request_id = $1
            )
          )
          OR (
            ae.entity_type = 'import'
            AND EXISTS (
              SELECT 1 FROM imports i
               WHERE i.id = ae.entity_id AND i.request_id = $1
            )
          )
        ORDER BY ae.created_at ASC, ae.id ASC`,
      [input.requestId],
    );

    return { kind: "ok" as const, events: events.rows };
  });
}

export async function exportTenantAudit(input: {
  tenantId: string;
  userId: string;
  from?: Date;
  to?: Date;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const role = await client.query(
      `SELECT 1
         FROM tenant_users
        WHERE tenant_id = $1 AND user_id = $2
          AND role IN ('ADMIN', 'AUDITOR') AND active = true
        LIMIT 1`,
      [input.tenantId, input.userId],
    );
    if (role.rowCount !== 1) return { kind: "forbidden" as const };

    const events = await client.query(
      `SELECT id, actor_user_id, action, entity_type, entity_id,
              before_data, after_data, created_at
         FROM audit_events
        WHERE ($1::timestamptz IS NULL OR created_at >= $1)
          AND ($2::timestamptz IS NULL OR created_at <= $2)
        ORDER BY created_at, id`,
      [input.from ?? null, input.to ?? null],
    );

    return { kind: "ok" as const, events: events.rows };
  });
}
