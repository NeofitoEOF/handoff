import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";

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

    const lines = [
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
