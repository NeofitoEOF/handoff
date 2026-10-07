import { expect, it, vi } from "vitest";

vi.mock("./config.js", () => ({ config: { TENANT_RATE_LIMIT_PER_MINUTE: 1000 } }));
const transaction = vi.fn();
vi.mock("./db.js", () => ({ withTenantTransaction: (...args: unknown[]) => transaction(...args) }));

it("returns a retryable 429 after the shared budget is exhausted", async () => {
  const { enforceTenantRateLimit } = await import("./tenant-rate-limit.js");
  transaction.mockResolvedValueOnce({ allowed: false, retry_after: 17 });
  await expect(enforceTenantRateLimit("tenant")).rejects.toMatchObject({ statusCode: 429, retryAfter: 17 });
  transaction.mockResolvedValueOnce({ allowed: true, retry_after: 17 });
  await expect(enforceTenantRateLimit("tenant")).resolves.toBeUndefined();
});
