import { describe, expect, it } from "vitest";
import {
  createScopedToken,
  hashScopedToken,
  tenantIdFromScopedToken,
} from "./scoped-token.js";

describe("scoped tenant tokens", () => {
  const tenantId = "11111111-2222-4333-8444-555555555555";

  it("embeds and recovers the tenant id", () => {
    const token = createScopedToken(tenantId);
    expect(token.startsWith(`${tenantId}.`)).toBe(true);
    expect(tenantIdFromScopedToken(token)).toBe(tenantId);
  });

  it("generates distinct opaque tokens", () => {
    const first = createScopedToken(tenantId);
    const second = createScopedToken(tenantId);

    expect(first).not.toBe(second);
    expect(hashScopedToken(first)).not.toBe(hashScopedToken(second));
  });

  it("rejects malformed tokens", () => {
    expect(tenantIdFromScopedToken("not-a-token")).toBeNull();
    expect(
      tenantIdFromScopedToken("11111111-2222-4333-8444-555555555555.short"),
    ).toBeNull();
    expect(
      tenantIdFromScopedToken("not-a-uuid.this-secret-is-long-enough-to-look-valid"),
    ).toBeNull();
  });
});
