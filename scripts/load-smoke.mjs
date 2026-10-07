const baseUrl = process.env.HANDOFF_BASE_URL ?? "http://localhost:3000";
const path = process.env.HANDOFF_LOAD_PATH ?? "/health";
const concurrency = Number(process.env.HANDOFF_LOAD_CONCURRENCY ?? "20");
const requests = Number(process.env.HANDOFF_LOAD_REQUESTS ?? "500");
const expectedP95Ms = Number(process.env.HANDOFF_LOAD_P95_MS ?? "300");

if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Invalid concurrency.");
if (!Number.isInteger(requests) || requests < 1) throw new Error("Invalid request count.");

const durations = [];
let failures = 0;
let cursor = 0;

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= requests) return;

    const started = performance.now();
    try {
      const response = await fetch(new URL(path, baseUrl));
      await response.arrayBuffer();
      if (!response.ok) failures += 1;
    } catch {
      failures += 1;
    } finally {
      durations.push(performance.now() - started);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, () => worker()));

durations.sort((a, b) => a - b);
const percentile = (p) => durations[Math.min(durations.length - 1, Math.ceil(durations.length * p) - 1)] ?? 0;
const p50 = percentile(0.5);
const p95 = percentile(0.95);
const p99 = percentile(0.99);

console.log(JSON.stringify({
  baseUrl,
  path,
  requests,
  concurrency,
  failures,
  p50Ms: Number(p50.toFixed(2)),
  p95Ms: Number(p95.toFixed(2)),
  p99Ms: Number(p99.toFixed(2)),
}, null, 2));

if (failures > 0) process.exitCode = 1;
if (p95 > expectedP95Ms) {
  console.error(`p95 ${p95.toFixed(2)}ms exceeded target ${expectedP95Ms}ms`);
  process.exitCode = 1;
}
