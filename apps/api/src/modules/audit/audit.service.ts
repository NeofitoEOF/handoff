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
          OR (
            ae.entity_type = 'comment'
            AND EXISTS (
              SELECT 1 FROM comments c
               WHERE c.id = ae.entity_id AND c.request_id = $1
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


export async function verifyTenantAuditChain(input: {
  tenantId: string;
  userId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const role = await client.query(
      `SELECT 1
         FROM tenant_users
        WHERE tenant_id = $1
          AND user_id = $2
          AND role IN ('ADMIN', 'AUDITOR')
          AND active = true
        LIMIT 1`,
      [input.tenantId, input.userId],
    );

    if (role.rowCount !== 1) return { kind: "forbidden" as const };

    const events = await client.query<{
      id: string;
      chain_seq: string;
      prev_hash: string | null;
      hash: string;
      calculated_hash: string;
    }>(
      `SELECT
          id,
          chain_seq::text,
          prev_hash,
          hash,
          encode(
            digest(
              convert_to(
                jsonb_build_object(
                  'tenant_id', tenant_id,
                  'actor_user_id', actor_user_id,
                  'action', action,
                  'entity_type', entity_type,
                  'entity_id', entity_id,
                  'before_data', before_data,
                  'after_data', after_data,
                  'created_at', created_at,
                  'chain_seq', chain_seq,
                  'prev_hash', prev_hash
                )::text,
                'UTF8'
              ),
              'sha256'
            ),
            'hex'
          ) AS calculated_hash
        FROM audit_events
       ORDER BY chain_seq ASC`,
    );

    let previousHash: string | null = null;
    let expectedSeq = 1;

    for (const event of events.rows) {
      const sequence = Number(event.chain_seq);

      if (
        sequence !== expectedSeq ||
        event.prev_hash !== previousHash ||
        event.hash !== event.calculated_hash
      ) {
        return {
          kind: "invalid" as const,
          eventId: event.id,
          chainSeq: sequence,
          expectedSeq,
          expectedPrevHash: previousHash,
          actualPrevHash: event.prev_hash,
          hashMatchesPayload: event.hash === event.calculated_hash,
        };
      }

      previousHash = event.hash;
      expectedSeq += 1;
    }

    return {
      kind: "valid" as const,
      eventCount: events.rowCount ?? 0,
      lastHash: previousHash,
    };
  });
}
