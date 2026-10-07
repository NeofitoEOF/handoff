import { pool, withTenantTransaction } from "../../db.js";
import { hashPassword } from "../identity/identity.service.js";
import { isTenantAdmin } from "../../authorization.js";

export async function provisionTenant(input: {
  name: string;
  document?: string;
  subdomain: string;
  adminEmail: string;
  adminName: string;
  adminPassword: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tenant = await client.query<{ id: string }>(
      `INSERT INTO tenants (name, document, subdomain)
       VALUES ($1, $2, lower($3))
       RETURNING id`,
      [input.name, input.document ?? null, input.subdomain],
    );
    const tenantId = tenant.rows[0]!.id;

    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const existing = await client.query<{ id: string; password_hash: string | null }>(
      `SELECT id, password_hash FROM users WHERE lower(email) = lower($1) LIMIT 1`,
      [input.adminEmail],
    );

    const passwordHash = await hashPassword(input.adminPassword);
    let userId: string;
    if (existing.rows[0]) {
      userId = existing.rows[0].id;
      if (!existing.rows[0].password_hash) {
        await client.query(
          `UPDATE users
              SET name = $2, password_hash = $3, password_changed_at = now(), active = true
            WHERE id = $1`,
          [userId, input.adminName, passwordHash],
        );
      }
    } else {
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (email, name, password_hash, password_changed_at)
         VALUES (lower($1), $2, $3, now())
         RETURNING id`,
        [input.adminEmail, input.adminName, passwordHash],
      );
      userId = user.rows[0]!.id;
    }

    await client.query(
      `INSERT INTO tenant_users (tenant_id, user_id, role, active)
       VALUES ($1, $2, 'ADMIN', true)`,
      [tenantId, userId],
    );

    await client.query("COMMIT");
    return { tenantId, adminUserId: userId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function suspendTenant(tenantId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE tenants SET active = false WHERE id = $1`,
      [tenantId],
    );
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query(
      `UPDATE refresh_sessions
          SET revoked_at = COALESCE(revoked_at, now())
        WHERE tenant_id = $1`,
      [tenantId],
    );
    await client.query("COMMIT");
    return { suspended: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function exportTenantData(input: {
  tenantId: string;
  actorUserId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await isTenantAdmin(client, input.tenantId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const [
      tenant,
      sectors,
      memberships,
      templates,
      templateVersions,
      requests,
      items,
      attachments,
      imports,
      snapshots,
      auditEvents,
    ] = await Promise.all([
      client.query(`SELECT id, name, document, subdomain, active, created_at FROM tenants WHERE id = $1`, [input.tenantId]),
      client.query(`SELECT * FROM sectors ORDER BY created_at`),
      client.query(`SELECT * FROM memberships ORDER BY created_at`),
      client.query(`SELECT * FROM templates ORDER BY created_at`),
      client.query(`SELECT * FROM template_versions ORDER BY template_id, version`),
      client.query(`SELECT * FROM requests ORDER BY created_at`),
      client.query(`SELECT * FROM request_items ORDER BY request_id, created_at`),
      client.query(`SELECT id, tenant_id, request_id, item_id, uploaded_by, filename, mime_type, size_bytes, sha256, storage_key, status, created_at FROM attachments ORDER BY created_at`),
      client.query(`SELECT id, tenant_id, request_id, uploaded_by, filename, storage_key, sha256, status, total_rows, accepted_rows, rejected_rows, errors, created_at, completed_at FROM imports ORDER BY created_at`),
      client.query(`SELECT * FROM snapshots ORDER BY created_at`),
      client.query(`SELECT * FROM audit_events ORDER BY created_at, id`),
    ]);

    return {
      kind: "ok" as const,
      exportedAt: new Date().toISOString(),
      tenant: tenant.rows[0],
      sectors: sectors.rows,
      memberships: memberships.rows,
      templates: templates.rows,
      templateVersions: templateVersions.rows,
      requests: requests.rows,
      requestItems: items.rows,
      attachments: attachments.rows,
      imports: imports.rows,
      snapshots: snapshots.rows,
      auditEvents: auditEvents.rows,
    };
  });
}
