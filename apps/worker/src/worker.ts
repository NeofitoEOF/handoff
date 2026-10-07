import pg from "pg";
import nodemailer from "nodemailer";
import { config } from "./config.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: config.DATABASE_URL, max: 5 });

const transporter =
  config.EMAIL_TRANSPORT === "smtp"
    ? nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        auth:
          config.SMTP_USER && config.SMTP_PASS
            ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
            : undefined,
      })
    : null;

async function withTenant<T>(tenantId: string, fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function enqueueReminders(tenantId: string) {
  await withTenant(tenantId, async (client) => {
    const rows = await client.query<{
      id: string;
      title: string;
      due_at: Date;
      assigned_to: string | null;
      assignee_email: string | null;
    }>(
      `SELECT r.id, r.title, r.due_at, r.assigned_to, u.email AS assignee_email
         FROM requests r
         LEFT JOIN users u ON u.id = r.assigned_to
        WHERE r.status NOT IN ('CLOSED', 'CANCELLED')
          AND r.due_at <= now() + interval '48 hours'`,
    );

    const day = new Date().toISOString().slice(0, 10);
    for (const row of rows.rows) {
      if (!row.assignee_email) continue;

      const overdue = row.due_at.getTime() < Date.now();
      const dedupeKey = overdue
        ? `request:${row.id}:overdue:${day}`
        : `request:${row.id}:due48`;

      const subject = overdue
        ? `[Handoff] Solicitação atrasada: ${row.title}`
        : `[Handoff] Prazo próximo: ${row.title}`;

      const body = overdue
        ? `A solicitação "${row.title}" está atrasada desde ${row.due_at.toISOString()}.`
        : `A solicitação "${row.title}" vence em ${row.due_at.toISOString()}.`;

      await client.query(
        `INSERT INTO email_outbox
          (tenant_id, request_id, recipient_email, subject, body_text, dedupe_key)
         VALUES ($1, $2, lower($3), $4, $5, $6)
         ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
        [tenantId, row.id, row.assignee_email, subject, body, dedupeKey],
      );

      if (row.assigned_to) {
        await client.query(
          `INSERT INTO notifications
            (tenant_id, user_id, request_id, type, title, message)
           SELECT $1, $2, $3, $4, $5, $6
           WHERE NOT EXISTS (
             SELECT 1 FROM notifications
              WHERE tenant_id = $1
                AND user_id = $2
                AND request_id = $3
                AND type = $4
                AND created_at::date = current_date
           )`,
          [
            tenantId,
            row.assigned_to,
            row.id,
            overdue ? "OVERDUE" : "DUE_SOON",
            subject,
            body,
          ],
        );
      }
    }

    const unassigned = await client.query<{
      id: string;
      title: string;
      destination_sector_id: string;
    }>(
      `SELECT id, title, destination_sector_id
         FROM requests
        WHERE assigned_to IS NULL
          AND status IN ('OPEN', 'WAITING_REASSIGNMENT')
          AND created_at <= now() - interval '4 hours'`,
    );

    for (const row of unassigned.rows) {
      const managers = await client.query<{ user_id: string; email: string }>(
        `SELECT m.user_id, u.email
           FROM memberships m
           JOIN users u ON u.id = m.user_id
          WHERE m.sector_id = $1
            AND m.role = 'MANAGER'
            AND m.active = true
            AND u.active = true`,
        [row.destination_sector_id],
      );

      for (const manager of managers.rows) {
        const dedupeKey = `request:${row.id}:unassigned:${day}:${manager.user_id}`;
        await client.query(
          `INSERT INTO email_outbox
            (tenant_id, request_id, recipient_email, subject, body_text, dedupe_key)
           VALUES ($1, $2, lower($3), $4, $5, $6)
           ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
          [
            tenantId,
            row.id,
            manager.email,
            `[Handoff] Solicitação aguardando atribuição: ${row.title}`,
            `A solicitação "${row.title}" está sem responsável há mais de 4 horas.`,
            dedupeKey,
          ],
        );
      }
    }
  });
}

async function processOutbox(tenantId: string) {
  const claimed = await withTenant(tenantId, async (client) => {
    const result = await client.query<{
      id: string;
      recipient_email: string;
      subject: string;
      body_text: string;
      attempts: number;
    }>(
      `SELECT id, recipient_email, subject, body_text, attempts
         FROM email_outbox
        WHERE status IN ('PENDING', 'FAILED')
          AND available_at <= now()
          AND attempts < 5
        ORDER BY created_at
        LIMIT 20
        FOR UPDATE SKIP LOCKED`,
    );

    if (result.rows.length) {
      await client.query(
        `UPDATE email_outbox
            SET status = 'PROCESSING'
          WHERE id = ANY($1::uuid[])`,
        [result.rows.map((x) => x.id)],
      );
    }
    return result.rows;
  });

  for (const email of claimed) {
    try {
      if (transporter) {
        await transporter.sendMail({
          from: config.EMAIL_FROM,
          to: email.recipient_email,
          subject: email.subject,
          text: email.body_text,
        });
      } else {
        process.stdout.write(
          `[email:log] to=${email.recipient_email} subject=${JSON.stringify(email.subject)}\n`,
        );
      }

      await withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE email_outbox
              SET status = 'SENT', sent_at = now(), attempts = attempts + 1, last_error = NULL
            WHERE id = $1`,
          [email.id],
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE email_outbox
              SET status = 'FAILED',
                  attempts = attempts + 1,
                  last_error = $2,
                  available_at = now() + make_interval(mins => LEAST(60, (attempts + 1) * 5))
            WHERE id = $1`,
          [email.id, message.slice(0, 2000)],
        );
      });
    }
  }
}

async function tick() {
  const tenants = await pool.query<{ id: string }>(
    `SELECT id FROM tenants WHERE active = true ORDER BY id`,
  );
  for (const tenant of tenants.rows) {
    await enqueueReminders(tenant.id);
    await processOutbox(tenant.id);
  }
}

let running = false;
async function safeTick() {
  if (running) return;
  running = true;
  try {
    await tick();
  } catch (error) {
    process.stderr.write(
      `[worker] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
  } finally {
    running = false;
  }
}

await safeTick();
setInterval(() => void safeTick(), config.WORKER_POLL_MS);
