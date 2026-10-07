import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { pool } from "./db.js";

const startedAt = process.hrtime.bigint();
const requestStarted = new WeakMap<FastifyRequest, bigint>();

type MetricKey = string;
type MetricValue = {
  method: string;
  route: string;
  status: number;
  count: number;
  durationSeconds: number;
};

const httpMetrics = new Map<MetricKey, MetricValue>();

type QueueMetric = {
  pending: number;
  deadLetters: number;
  oldestPendingSeconds: number;
};

type QueueMetrics = Record<"email" | "teams" | "webhook" | "closure", QueueMetric>;

function emptyQueueMetrics(): QueueMetrics {
  return {
    email: { pending: 0, deadLetters: 0, oldestPendingSeconds: 0 },
    teams: { pending: 0, deadLetters: 0, oldestPendingSeconds: 0 },
    webhook: { pending: 0, deadLetters: 0, oldestPendingSeconds: 0 },
    closure: { pending: 0, deadLetters: 0, oldestPendingSeconds: 0 },
  };
}

export async function collectOperationalQueueMetrics(): Promise<QueueMetrics> {
  const totals = emptyQueueMetrics();
  const tenants = await pool.query<{ id: string }>(
    `SELECT id FROM tenants WHERE active = true ORDER BY id`,
  );

  const client = await pool.connect();
  try {
    for (const tenant of tenants.rows) {
      await client.query("BEGIN");
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id]);

        const result = await client.query<{
          queue: keyof QueueMetrics;
          pending: string;
          dead_letters: string;
          oldest_pending_seconds: string | null;
        }>(
          `
          SELECT 'email'::text AS queue,
                 count(*) FILTER (
                   WHERE status IN ('PENDING', 'FAILED', 'PROCESSING')
                     AND attempts < 5
                 )::text AS pending,
                 count(*) FILTER (
                   WHERE status = 'FAILED' AND attempts >= 5
                 )::text AS dead_letters,
                 COALESCE(
                   EXTRACT(EPOCH FROM (
                     now() - min(created_at) FILTER (
                       WHERE status IN ('PENDING', 'FAILED', 'PROCESSING')
                         AND attempts < 5
                     )
                   )),
                   0
                 )::text AS oldest_pending_seconds
            FROM email_outbox
          UNION ALL
          SELECT 'teams'::text,
                 count(*) FILTER (
                   WHERE status IN ('PENDING', 'FAILED', 'PROCESSING')
                     AND attempts < 5
                 )::text,
                 count(*) FILTER (
                   WHERE status = 'FAILED' AND attempts >= 5
                 )::text,
                 COALESCE(
                   EXTRACT(EPOCH FROM (
                     now() - min(created_at) FILTER (
                       WHERE status IN ('PENDING', 'FAILED', 'PROCESSING')
                         AND attempts < 5
                     )
                   )),
                   0
                 )::text
            FROM teams_outbox
          UNION ALL
          SELECT 'webhook'::text,
                 count(*) FILTER (
                   WHERE status IN ('PENDING', 'FAILED', 'PROCESSING')
                     AND attempts < 8
                 )::text,
                 count(*) FILTER (
                   WHERE status = 'FAILED' AND attempts >= 8
                 )::text,
                 COALESCE(
                   EXTRACT(EPOCH FROM (
                     now() - min(created_at) FILTER (
                       WHERE status IN ('PENDING', 'FAILED', 'PROCESSING')
                         AND attempts < 8
                     )
                   )),
                   0
                 )::text
            FROM webhook_outbox
          UNION ALL
          SELECT 'closure'::text,
                 count(*) FILTER (
                   WHERE status IN ('PENDING', 'FAILED', 'PROCESSING')
                     AND attempts < 5
                 )::text,
                 count(*) FILTER (
                   WHERE status = 'FAILED' AND attempts >= 5
                 )::text,
                 COALESCE(
                   EXTRACT(EPOCH FROM (
                     now() - min(created_at) FILTER (
                       WHERE status IN ('PENDING', 'FAILED', 'PROCESSING')
                         AND attempts < 5
                     )
                   )),
                   0
                 )::text
            FROM closure_documents
          `,
        );

        for (const row of result.rows) {
          const metric = totals[row.queue];
          metric.pending += Number(row.pending);
          metric.deadLetters += Number(row.dead_letters);
          metric.oldestPendingSeconds = Math.max(
            metric.oldestPendingSeconds,
            Number(row.oldest_pending_seconds ?? 0),
          );
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }

  return totals;
}


function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

function routeName(request: FastifyRequest): string {
  return request.routeOptions?.url ?? request.url.split("?")[0] ?? "unknown";
}

export async function registerMetrics(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (request) => {
    requestStarted.set(request, process.hrtime.bigint());
  });

  app.addHook("onResponse", async (request, reply) => {
    const start = requestStarted.get(request);
    if (!start) return;

    const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
    const method = request.method;
    const route = routeName(request);
    const status = reply.statusCode;
    const key = `${method}|${route}|${status}`;
    const existing = httpMetrics.get(key);

    if (existing) {
      existing.count += 1;
      existing.durationSeconds += durationSeconds;
      return;
    }

    httpMetrics.set(key, {
      method,
      route,
      status,
      count: 1,
      durationSeconds,
    });
  });

  app.get("/internal/metrics", async (request, reply) => {
    if (config.NODE_ENV === "production") {
      const expected = config.METRICS_TOKEN;
      const authorization = request.headers.authorization;
      if (!expected || authorization !== `Bearer ${expected}`) {
        return reply.code(401).send({ message: "Não autorizado." });
      }
    }

    let databaseUp = 1;
    let queueMetrics: QueueMetrics | null = null;
    try {
      await pool.query("SELECT 1");
      queueMetrics = await collectOperationalQueueMetrics();
    } catch {
      databaseUp = 0;
    }

    const lines = [
      "# HELP handoff_database_up Database connectivity status (1=up, 0=down).",
      "# TYPE handoff_database_up gauge",
      `handoff_database_up ${databaseUp}`,
      "# HELP handoff_process_uptime_seconds Process uptime in seconds.",
      "# TYPE handoff_process_uptime_seconds gauge",
      `handoff_process_uptime_seconds ${Number(process.hrtime.bigint() - startedAt) / 1_000_000_000}`,
      "# HELP handoff_nodejs_heap_used_bytes Node.js heap used in bytes.",
      "# TYPE handoff_nodejs_heap_used_bytes gauge",
      `handoff_nodejs_heap_used_bytes ${process.memoryUsage().heapUsed}`,
      "# HELP handoff_http_requests_total Total HTTP requests.",
      "# TYPE handoff_http_requests_total counter",
      "# HELP handoff_http_request_duration_seconds_sum Cumulative request duration.",
      "# TYPE handoff_http_request_duration_seconds_sum counter",
    ];

    if (queueMetrics) {
      lines.push(
        "# HELP handoff_outbox_pending Retryable items waiting or processing.",
        "# TYPE handoff_outbox_pending gauge",
        "# HELP handoff_outbox_dead_letters Items that exhausted automatic retries.",
        "# TYPE handoff_outbox_dead_letters gauge",
        "# HELP handoff_outbox_oldest_pending_seconds Age in seconds of the oldest retryable item.",
        "# TYPE handoff_outbox_oldest_pending_seconds gauge",
      );

      for (const [queue, metric] of Object.entries(queueMetrics)) {
        const label = `queue="${escapeLabel(queue)}"`;
        lines.push(`handoff_outbox_pending{${label}} ${metric.pending}`);
        lines.push(`handoff_outbox_dead_letters{${label}} ${metric.deadLetters}`);
        lines.push(
          `handoff_outbox_oldest_pending_seconds{${label}} ${metric.oldestPendingSeconds}`,
        );
      }
    }

    for (const metric of httpMetrics.values()) {
      const labels =
        `method="${escapeLabel(metric.method)}",route="${escapeLabel(metric.route)}",status="${metric.status}"`;
      lines.push(`handoff_http_requests_total{${labels}} ${metric.count}`);
      lines.push(
        `handoff_http_request_duration_seconds_sum{${labels}} ${metric.durationSeconds}`,
      );
    }

    return reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(lines.join("\n") + "\n");
  });
}
