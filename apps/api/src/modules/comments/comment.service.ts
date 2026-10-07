import { withTenantTransaction } from "../../db.js";

async function canAccessRequest(
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

export async function listComments(input: {
  tenantId: string;
  requestId: string;
  actorUserId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await canAccessRequest(client, input.requestId, input.actorUserId))) {
      return { kind: "not_found" as const };
    }

    const result = await client.query(
      `SELECT c.id, c.item_id, c.field_key, c.text, c.created_at,
              c.author_user_id, u.name AS author_name,
              c.guest_link_id, gl.email AS guest_email
         FROM comments c
         LEFT JOIN users u ON u.id = c.author_user_id
         LEFT JOIN guest_links gl ON gl.id = c.guest_link_id
        WHERE c.request_id = $1
        ORDER BY c.created_at, c.id`,
      [input.requestId],
    );

    return {
      kind: "ok" as const,
      comments: result.rows.map((row) => ({
        id: row.id,
        itemId: row.item_id,
        fieldKey: row.field_key,
        text: row.text,
        createdAt: row.created_at,
        author: row.guest_email ?? row.author_name ?? "Sistema",
      })),
    };
  });
}

export async function addComment(input: {
  tenantId: string;
  requestId: string;
  actorUserId: string;
  itemId?: string;
  fieldKey?: string;
  text: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await canAccessRequest(client, input.requestId, input.actorUserId))) {
      return { kind: "not_found" as const };
    }

    if (input.itemId) {
      const item = await client.query(
        `SELECT 1 FROM request_items WHERE id = $1 AND request_id = $2 LIMIT 1`,
        [input.itemId, input.requestId],
      );
      if (item.rowCount !== 1) return { kind: "item_not_found" as const };
    }

    const created = await client.query(
      `INSERT INTO comments
        (tenant_id, request_id, item_id, field_key, author_user_id, text)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, item_id, field_key, text, created_at`,
      [
        input.tenantId,
        input.requestId,
        input.itemId ?? null,
        input.fieldKey ?? null,
        input.actorUserId,
        input.text,
      ],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'COMMENT_ADDED', 'comment', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        created.rows[0].id,
        JSON.stringify({
          requestId: input.requestId,
          itemId: input.itemId ?? null,
          fieldKey: input.fieldKey ?? null,
        }),
      ],
    );

    return { kind: "created" as const, comment: created.rows[0] };
  });
}
