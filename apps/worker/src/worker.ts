import pg from "pg";
import nodemailer from "nodemailer";
import { config } from "./config.js";
import { generatePdf, renderClosureHtml, storePdf } from "./pdf.js";
import { decryptTeamsWebhook, sendTeamsWebhook } from "./teams.js";
import { decryptWebhookSecret, sendSignedWebhook } from "./webhook.js";
import { storeAuditAnchor } from "./audit-anchor.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: config.DATABASE_URL, max: 5 });

const transporter =
  config.EMAIL_TRANSPORT === "smtp"
    ? nodemailer.createTransport({
        ...(config.SMTP_HOST ? { host: config.SMTP_HOST } : {}),
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        ...(config.SMTP_USER && config.SMTP_PASS
          ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS } }
          : {}),
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

function competenceFor(date: Date, frequency: "WEEKLY" | "MONTHLY"): string {
  if (frequency === "MONTHLY") {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function nextOccurrence(date: Date, frequency: "WEEKLY" | "MONTHLY"): Date {
  const next = new Date(date);
  if (frequency === "WEEKLY") {
    next.setUTCDate(next.getUTCDate() + 7);
  } else {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next;
}

function previousUtcDate(): string {
  const now = new Date();
  const yesterday = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - 1,
  ));
  return yesterday.toISOString().slice(0, 10);
}

async function processAuditAnchor(tenantId: string) {
  const anchorDate = previousUtcDate();

  await withTenant(tenantId, async (client) => {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`audit-anchor:${tenantId}:${anchorDate}`],
    );

    const existing = await client.query(
      `SELECT 1
         FROM audit_anchors
        WHERE anchor_date = $1::date
        LIMIT 1`,
      [anchorDate],
    );
    if (existing.rowCount === 1) return;

    const chain = await client.query<{ chain_seq: string; hash: string }>(
      `SELECT chain_seq::text, hash
         FROM audit_events
        WHERE created_at < ($1::date + interval '1 day')
        ORDER BY chain_seq DESC
        LIMIT 1`,
      [anchorDate],
    );
    const latest = chain.rows[0];
    if (!latest) return;

    const previous = await client.query<{ manifest_sha256: string }>(
      `SELECT manifest_sha256
         FROM audit_anchors
        WHERE anchor_date < $1::date
        ORDER BY anchor_date DESC
        LIMIT 1`,
      [anchorDate],
    );

    const stored = await storeAuditAnchor({
      tenantId,
      anchorDate,
      chainSeq: Number(latest.chain_seq),
      chainHash: latest.hash,
      previousAnchorSha256: previous.rows[0]?.manifest_sha256 ?? null,
    });

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO audit_anchors
        (tenant_id, anchor_date, chain_seq, chain_hash, manifest_sha256,
         storage_bucket, storage_key)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        tenantId,
        anchorDate,
        Number(latest.chain_seq),
        latest.hash,
        stored.manifestSha256,
        stored.bucket,
        stored.key,
      ],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, NULL, 'AUDIT_CHAIN_ANCHORED', 'audit_anchor', $2, $3::jsonb)`,
      [
        tenantId,
        inserted.rows[0]!.id,
        JSON.stringify({
          anchorDate,
          chainSeq: Number(latest.chain_seq),
          chainHash: latest.hash,
          manifestSha256: stored.manifestSha256,
          storageKey: stored.key,
        }),
      ],
    );
  });
}

async function materializeRecurrences(tenantId: string) {
  await withTenant(tenantId, async (client) => {
    const recurrences = await client.query<{
      id: string;
      origin_sector_id: string;
      template_version_id: string | null;
      destination_sector_ids: string[];
      title: string;
      instructions: string | null;
      frequency: "WEEKLY" | "MONTHLY";
      next_run_at: Date;
      due_offset_days: number;
      created_by: string;
    }>(
      `SELECT id, origin_sector_id, template_version_id, destination_sector_ids,
              title, instructions, frequency, next_run_at, due_offset_days, created_by
         FROM recurrences
        WHERE active = true
          AND next_run_at <= now()
        ORDER BY next_run_at
        LIMIT 20
        FOR UPDATE SKIP LOCKED`,
      [config.WORKER_PROCESSING_LEASE_MINUTES],
    );

    for (const recurrence of recurrences.rows) {
      const scheduledFor = recurrence.next_run_at;
      const run = await client.query<{ id: string }>(
        `INSERT INTO recurrence_runs (tenant_id, recurrence_id, scheduled_for)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, recurrence_id, scheduled_for) DO NOTHING
         RETURNING id`,
        [tenantId, recurrence.id, scheduledFor],
      );

      if (run.rowCount === 1) {
        const dueAt = new Date(scheduledFor);
        dueAt.setUTCDate(dueAt.getUTCDate() + recurrence.due_offset_days);
        const competence = competenceFor(scheduledFor, recurrence.frequency);

        const campaign = await client.query<{ id: string }>(
          `INSERT INTO campaigns
            (tenant_id, origin_sector_id, template_version_id, title, competence,
             due_at, instructions, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            tenantId,
            recurrence.origin_sector_id,
            recurrence.template_version_id,
            recurrence.title,
            competence,
            dueAt,
            recurrence.instructions,
            recurrence.created_by,
          ],
        );
        const campaignId = campaign.rows[0]!.id;

        const destinations = await client.query<{ id: string }>(
          `SELECT id
             FROM sectors
            WHERE id = ANY($1::uuid[])
              AND active = true
              AND id <> $2`,
          [recurrence.destination_sector_ids, recurrence.origin_sector_id],
        );

        for (const destination of destinations.rows) {
          const request = await client.query<{ id: string }>(
            `INSERT INTO requests
              (tenant_id, origin_sector_id, destination_sector_id, created_by, title,
               due_at, status, competence, instructions, template_version_id)
             VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $8, $9)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [
              tenantId,
              recurrence.origin_sector_id,
              destination.id,
              recurrence.created_by,
              recurrence.title,
              dueAt,
              competence,
              recurrence.instructions,
              recurrence.template_version_id,
            ],
          );

          if (request.rows[0]) {
            await client.query(
              `INSERT INTO campaign_requests
                (tenant_id, campaign_id, request_id, destination_sector_id)
               VALUES ($1, $2, $3, $4)`,
              [tenantId, campaignId, request.rows[0].id, destination.id],
            );
          }
        }

        await client.query(
          `UPDATE recurrence_runs SET campaign_id = $2 WHERE id = $1`,
          [run.rows[0]!.id, campaignId],
        );
      }

      await client.query(
        `UPDATE recurrences SET next_run_at = $2 WHERE id = $1`,
        [recurrence.id, nextOccurrence(scheduledFor, recurrence.frequency)],
      );
    }
  });
}

async function processClosureDocuments(tenantId: string) {
  const claimed = await withTenant(tenantId, async (client) => {
    const result = await client.query<{
      id: string;
      request_id: string;
      snapshot_id: string;
      content: Record<string, unknown>;
      attempts: number;
    }>(
      `SELECT cd.id, cd.request_id, cd.snapshot_id, s.content, cd.attempts
         FROM closure_documents cd
         JOIN snapshots s ON s.id = cd.snapshot_id
        WHERE (
          (cd.status IN ('PENDING', 'FAILED') AND cd.available_at <= now())
          OR
          (cd.status = 'PROCESSING'
            AND cd.processing_started_at <= now() - make_interval(mins => $1))
        )
          AND cd.attempts < 5
        ORDER BY cd.created_at
        LIMIT 5
        FOR UPDATE OF cd SKIP LOCKED`,
      [config.WORKER_PROCESSING_LEASE_MINUTES],
    );

    if (result.rows.length) {
      await client.query(
        `UPDATE closure_documents
            SET status = 'PROCESSING',
                processing_started_at = now()
          WHERE id = ANY($1::uuid[])`,
        [result.rows.map((row) => row.id)],
      );
    }

    return result.rows;
  });

  for (const document of claimed) {
    try {
      const html = renderClosureHtml(document.content);
      const pdf = await generatePdf(html);
      const stored = await storePdf({
        tenantId,
        requestId: document.request_id,
        pdf,
      });

      await withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE closure_documents
              SET status = 'READY',
                  pdf_storage_key = $2,
                  pdf_sha256 = $3,
                  attempts = attempts + 1,
                  generated_at = now(),
                  last_error = NULL,
                  processing_started_at = NULL
            WHERE id = $1`,
          [document.id, stored.storageKey, stored.sha256],
        );

        await client.query(
          `INSERT INTO audit_events
            (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
           VALUES ($1, NULL, 'CLOSURE_PDF_GENERATED', 'request', $2, $3::jsonb)`,
          [
            tenantId,
            document.request_id,
            JSON.stringify({
              closureDocumentId: document.id,
              sha256: stored.sha256,
            }),
          ],
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE closure_documents
              SET status = 'FAILED',
                  attempts = attempts + 1,
                  last_error = $2,
                  processing_started_at = NULL,
                  available_at = now() + make_interval(mins => LEAST(60, (attempts + 1) * 5))
            WHERE id = $1`,
          [document.id, message.slice(0, 2000)],
        );
      });
    }
  }
}

async function processTeamsOutbox(tenantId: string) {
  const claimed = await withTenant(tenantId, async (client) => {
    const result = await client.query<{
      id: string;
      request_id: string | null;
      title: string;
      message: string;
      attempts: number;
      teams_webhook_ciphertext: string;
      teams_webhook_iv: string;
      teams_webhook_tag: string;
    }>(
      `SELECT o.id, o.request_id, o.title, o.message, o.attempts,
              i.teams_webhook_ciphertext,
              i.teams_webhook_iv,
              i.teams_webhook_tag
         FROM teams_outbox o
         JOIN tenant_microsoft_integrations i ON i.tenant_id = o.tenant_id
        WHERE (
          (o.status IN ('PENDING', 'FAILED') AND o.available_at <= now())
          OR
          (o.status = 'PROCESSING'
            AND o.processing_started_at <= now() - make_interval(mins => $1))
        )
          AND o.attempts < 5
          AND i.enabled = true
          AND i.teams_webhook_ciphertext IS NOT NULL
          AND i.teams_webhook_iv IS NOT NULL
          AND i.teams_webhook_tag IS NOT NULL
        ORDER BY o.created_at
        LIMIT 20
        FOR UPDATE OF o SKIP LOCKED`,
      [config.WORKER_PROCESSING_LEASE_MINUTES],
    );

    if (result.rows.length) {
      await client.query(
        `UPDATE teams_outbox
            SET status = 'PROCESSING',
                processing_started_at = now()
          WHERE id = ANY($1::uuid[])`,
        [result.rows.map((row) => row.id)],
      );
    }

    return result.rows;
  });

  for (const event of claimed) {
    try {
      const webhookUrl = decryptTeamsWebhook({
        ciphertext: event.teams_webhook_ciphertext,
        iv: event.teams_webhook_iv,
        tag: event.teams_webhook_tag,
      });

      await sendTeamsWebhook(webhookUrl, {
        title: event.title,
        message: event.message,
        requestId: event.request_id,
      });

      await withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE teams_outbox
              SET status = 'SENT',
                  sent_at = now(),
                  attempts = attempts + 1,
                  last_error = NULL,
                  processing_started_at = NULL
            WHERE id = $1`,
          [event.id],
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE teams_outbox
              SET status = 'FAILED',
                  attempts = attempts + 1,
                  last_error = $2,
                  processing_started_at = NULL,
                  available_at = now() + make_interval(mins => LEAST(60, (attempts + 1) * 5))
            WHERE id = $1`,
          [event.id, message.slice(0, 2000)],
        );
      });
    }
  }
}

async function processWebhookOutbox(tenantId: string) {
  const claimed = await withTenant(tenantId, async (client) => {
    const result = await client.query<{
      id: string;
      event_id: string;
      event_type: string;
      payload: Record<string, unknown>;
      url: string;
      secret_ciphertext: string;
      secret_iv: string;
      secret_tag: string;
    }>(
      `SELECT o.id, o.event_id, o.event_type, o.payload,
              w.url, w.secret_ciphertext, w.secret_iv, w.secret_tag
         FROM webhook_outbox o
         JOIN webhooks w ON w.id = o.webhook_id
        WHERE (
          (o.status IN ('PENDING', 'FAILED') AND o.available_at <= now())
          OR
          (o.status = 'PROCESSING'
            AND o.processing_started_at <= now() - make_interval(mins => $1))
        )
          AND o.attempts < 8
          AND w.active = true
        ORDER BY o.created_at
        LIMIT 20
        FOR UPDATE OF o SKIP LOCKED`,
      [config.WORKER_PROCESSING_LEASE_MINUTES],
    );

    if (result.rows.length) {
      await client.query(
        `UPDATE webhook_outbox
            SET status = 'PROCESSING',
                processing_started_at = now()
          WHERE id = ANY($1::uuid[])`,
        [result.rows.map((row) => row.id)],
      );
    }

    return result.rows;
  });

  for (const event of claimed) {
    try {
      const secret = decryptWebhookSecret({
        ciphertext: event.secret_ciphertext,
        iv: event.secret_iv,
        tag: event.secret_tag,
      });

      await sendSignedWebhook({
        url: event.url,
        secret,
        eventId: event.event_id,
        eventType: event.event_type,
        payload: event.payload,
      });

      await withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE webhook_outbox
              SET status = 'SENT',
                  sent_at = now(),
                  attempts = attempts + 1,
                  last_error = NULL,
                  processing_started_at = NULL
            WHERE id = $1`,
          [event.id],
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE webhook_outbox
              SET status = 'FAILED',
                  attempts = attempts + 1,
                  last_error = $2,
                  processing_started_at = NULL,
                  available_at = now() + make_interval(mins => LEAST(60, power(2, LEAST(attempts, 5))::int))
            WHERE id = $1`,
          [event.id, message.slice(0, 2000)],
        );
      });
    }
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

      if (overdue) {
        const hooks = await client.query<{ id: string }>(
          `SELECT id FROM webhooks WHERE active = true AND 'request.overdue' = ANY(events)`,
        );
        for (const hook of hooks.rows) {
          await client.query(
            `INSERT INTO webhook_outbox
              (tenant_id, webhook_id, event_type, payload, dedupe_key)
             VALUES ($1, $2, 'request.overdue', $3::jsonb, $4)
             ON CONFLICT (tenant_id, webhook_id, dedupe_key) DO NOTHING`,
            [
              tenantId,
              hook.id,
              JSON.stringify({
                requestId: row.id,
                title: row.title,
                dueAt: row.due_at,
                status: "OVERDUE",
              }),
              `request:${row.id}:overdue:${day}`,
            ],
          );
        }
      }

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
        WHERE (
          (status IN ('PENDING', 'FAILED') AND available_at <= now())
          OR
          (status = 'PROCESSING'
            AND processing_started_at <= now() - make_interval(mins => $1))
        )
          AND attempts < 5
        ORDER BY created_at
        LIMIT 20
        FOR UPDATE SKIP LOCKED`,
      [config.WORKER_PROCESSING_LEASE_MINUTES],
    );

    if (result.rows.length) {
      await client.query(
        `UPDATE email_outbox
            SET status = 'PROCESSING',
                processing_started_at = now()
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
              SET status = 'SENT',
                  sent_at = now(),
                  attempts = attempts + 1,
                  last_error = NULL,
                  processing_started_at = NULL
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
                  processing_started_at = NULL,
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
    await processAuditAnchor(tenant.id);
    await materializeRecurrences(tenant.id);
    await processClosureDocuments(tenant.id);
    await processTeamsOutbox(tenant.id);
    await enqueueReminders(tenant.id);
    await processWebhookOutbox(tenant.id);
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
