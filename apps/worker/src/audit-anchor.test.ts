import { beforeAll, describe, expect, it } from "vitest";

describe("audit anchor manifest", () => {
  let buildAuditAnchorManifest: typeof import("./audit-anchor.js").buildAuditAnchorManifest;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
    process.env.OBJECT_STORAGE_ACCESS_KEY ??= "test-access";
    process.env.OBJECT_STORAGE_SECRET_KEY ??= "test-secret";
    process.env.INTEGRATION_ENCRYPTION_KEY ??= "11".repeat(32);

    ({ buildAuditAnchorManifest } = await import("./audit-anchor.js"));
  });

  it("produces a deterministic canonical manifest and SHA-256", () => {
    const input = {
      version: 1 as const,
      tenantId: "11111111-1111-1111-1111-111111111111",
      anchorDate: "2026-10-06",
      chainSeq: 42,
      chainHash: "a".repeat(64),
      previousAnchorSha256: "b".repeat(64),
    };

    const first = buildAuditAnchorManifest(input);
    const second = buildAuditAnchorManifest(input);

    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.sha256).toBe(second.sha256);
    expect(first.body.equals(second.body)).toBe(true);

    const parsed = JSON.parse(first.body.toString("utf8"));
    expect(parsed).toEqual(input);
  });

  it("changes the manifest hash when the anchored chain changes", () => {
    const base = {
      version: 1 as const,
      tenantId: "11111111-1111-1111-1111-111111111111",
      anchorDate: "2026-10-06",
      chainSeq: 42,
      chainHash: "a".repeat(64),
      previousAnchorSha256: null,
    };

    const first = buildAuditAnchorManifest(base);
    const changed = buildAuditAnchorManifest({
      ...base,
      chainSeq: 43,
      chainHash: "c".repeat(64),
    });

    expect(changed.sha256).not.toBe(first.sha256);
  });
});
