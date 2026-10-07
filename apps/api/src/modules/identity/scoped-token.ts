import crypto from "node:crypto";

const tenantIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createScopedToken(tenantId: string, bytes = 32): string {
  return `${tenantId}.${crypto.randomBytes(bytes).toString("base64url")}`;
}

export function tenantIdFromScopedToken(token: string): string | null {
  const separator = token.indexOf(".");
  if (separator <= 0) return null;

  const tenantId = token.slice(0, separator);
  const secret = token.slice(separator + 1);

  if (!tenantIdPattern.test(tenantId) || secret.length < 20) {
    return null;
  }

  return tenantId;
}

export function hashScopedToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
