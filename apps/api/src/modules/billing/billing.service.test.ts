import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DbClient } from "../../db.js";

vi.mock("../../config.js", () => ({ config: {} }));
vi.mock("../../db.js", () => ({ pool: {}, withTenantTransaction: vi.fn() }));

let checkCapacity: typeof import("./billing.service.js").checkTenantStorageCapacity;
beforeAll(async () => {
  ({ checkTenantStorageCapacity: checkCapacity } = await import("./billing.service.js"));
});

describe("storage quota", () => {
  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid byte count %s before querying", async bytes => {
    const query = vi.fn();
    await expect(checkCapacity({ query } as unknown as DbClient, "tenant", bytes)).rejects.toThrow(RangeError);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([0, 1])("accepts the exact boundary and rejects overflow of %s bytes", async overflow => {
    const limit = 10 * 1024 ** 3;
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ plan: "STARTER", status: "ACTIVE" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ bytes: String(limit - 10) }] });
    const result = await checkCapacity({ query } as unknown as DbClient, "tenant", 10 + overflow);
    expect(result.allowed).toBe(overflow === 0);
    expect(query.mock.calls[1]![0]).toContain("pg_advisory_xact_lock");
    expect(query.mock.calls[2]![0]).toContain("WHERE tenant_id = $1");
    expect(query.mock.calls[2]![1]).toEqual(["tenant"]);
  });
});
