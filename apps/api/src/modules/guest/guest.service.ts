import crypto from "node:crypto";
import { withTenantTransaction } from "../../db.js";
import { isSectorManager } from "../../authorization.js";
import { enqueueEmail } from "../notifications/notification.service.js";

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseScopedToken(token: string): { tenantId: string; secret: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const tenantId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!/^[0-9a-fA-F-]{36}$/.test(tenantId) || secret.length < 20) return null;
  return { tenantId, secret };
}

export async function createGuestLink(input: {
  tenantId: string;
  actorUserId: string;
  requestId: string;
  email: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    const requestResult = await client.query<{
      destination_sector_id: string;
      due_at: Date;
      status: string;
    }>(
      `SELECT destination_sector_id, due_at, status
         FROM requests
        WHERE id = $1
        FOR UPDATE`,
      [input.requestId],
    );
    const request = requestResult.rows[0];
    if (!request) return { kind: "not_found" as const };
    if (["APPROVED", "CLOSED", "CANCELLED"].includes(request.status)) {
      return { kind: "invalid_state" as const, status: request.status };
    }
    if (!(await isSectorManager(client, request.destination_sector_id, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }
    if (request.due_at.getTime() <= Date.now()) {
      return { kind: "expired_request" as const };
    }

    await client.query(
      `UPDATE guest_links
          SET revoked_at = now()
        WHERE request_id = $1
          AND lower(email) = lower($2)
          AND revoked_at IS NULL`,
      [input.requestId, input.email],
    );

    const random = crypto.randomBytes(32).toString("base64url");
    const token = `${input.tenantId}.${random}`;
    const tokenHash = hash(token);

    const created = await client.query<{ id: string }>(
      `INSERT INTO guest_links
        (tenant_id, request_id, email, link_token_hash, created_by, expires_at)
       VALUES ($1, $2, lower($3), $4, $5, $6)
       RETURNING id`,
      [input.tenantId, input.requestId, input.email, tokenHash, input.actorUserId, request.due_at],
    );

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'GUEST_LINK_CREATED', 'guest_link', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        created.rows[0]!.id,
        JSON.stringify({ requestId: input.requestId, email: input.email.toLowerCase() }),
      ],
    );

    return {
      kind: "created" as const,
      guestLinkId: created.rows[0]!.id,
      token,
      expiresAt: request.due_at,
    };
  });
}

export async function issueGuestOtp(linkToken: string) {
  const scoped = parseScopedToken(linkToken);
  if (!scoped) return { kind: "invalid_link" as const };

  return withTenantTransaction(scoped.tenantId, async (client) => {
    const linkResult = await client.query<{
      id: string;
      request_id: string;
      email: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT id, request_id, email, expires_at, revoked_at
         FROM guest_links
        WHERE link_token_hash = $1
        FOR UPDATE`,
      [hash(linkToken)],
    );
    const link = linkResult.rows[0];
    if (!link || link.revoked_at || link.expires_at.getTime() <= Date.now()) {
      return { kind: "invalid_link" as const };
    }

    await client.query(
      `UPDATE guest_otps
          SET consumed_at = COALESCE(consumed_at, now())
        WHERE guest_link_id = $1
          AND consumed_at IS NULL`,
      [link.id],
    );

    const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await client.query(
      `INSERT INTO guest_otps
        (tenant_id, guest_link_id, otp_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [scoped.tenantId, link.id, hash(otp), expiresAt],
    );

    await enqueueEmail(client, {
      tenantId: scoped.tenantId,
      requestId: link.request_id,
      recipientEmail: link.email,
      subject: "[Handoff] Seu código de acesso",
      bodyText: `Seu código de acesso é ${otp}. Ele expira em 10 minutos.`,
      dedupeKey: `guest-otp:${link.id}:${expiresAt.toISOString()}`,
    });

    return {
      kind: "issued" as const,
      email: link.email,
      otp,
      expiresAt,
    };
  });
}

export async function verifyGuestOtp(input: {
  linkToken: string;
  otp: string;
}) {
  const scoped = parseScopedToken(input.linkToken);
  if (!scoped) return { kind: "invalid_link" as const };

  return withTenantTransaction(scoped.tenantId, async (client) => {
    const linkResult = await client.query<{
      id: string;
      request_id: string;
      email: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT id, request_id, email, expires_at, revoked_at
         FROM guest_links
        WHERE link_token_hash = $1
        FOR UPDATE`,
      [hash(input.linkToken)],
    );
    const link = linkResult.rows[0];
    if (!link || link.revoked_at || link.expires_at.getTime() <= Date.now()) {
      return { kind: "invalid_link" as const };
    }

    const otpResult = await client.query<{
      id: string;
      otp_hash: string;
      attempts: number;
      expires_at: Date;
      consumed_at: Date | null;
    }>(
      `SELECT id, otp_hash, attempts, expires_at, consumed_at
         FROM guest_otps
        WHERE guest_link_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [link.id],
    );
    const otp = otpResult.rows[0];
    if (!otp || otp.consumed_at || otp.expires_at.getTime() <= Date.now()) {
      return { kind: "otp_expired" as const };
    }
    if (otp.attempts >= 5) return { kind: "otp_locked" as const };

    const expected = Buffer.from(otp.otp_hash);
    const actual = Buffer.from(hash(input.otp));
    const valid =
      expected.length === actual.length &&
      crypto.timingSafeEqual(expected, actual);

    if (!valid) {
      await client.query(
        `UPDATE guest_otps SET attempts = attempts + 1 WHERE id = $1`,
        [otp.id],
      );
      return { kind: "invalid_otp" as const, attemptsRemaining: Math.max(4 - otp.attempts, 0) };
    }

    await client.query(
      `UPDATE guest_otps SET consumed_at = now() WHERE id = $1`,
      [otp.id],
    );

    const random = crypto.randomBytes(32).toString("base64url");
    const sessionToken = `${scoped.tenantId}.${random}`;
    const sessionExpiresAt = new Date(
      Math.min(Date.now() + 8 * 60 * 60 * 1000, link.expires_at.getTime()),
    );

    await client.query(
      `INSERT INTO guest_sessions
        (tenant_id, guest_link_id, session_token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [scoped.tenantId, link.id, hash(sessionToken), sessionExpiresAt],
    );

    return {
      kind: "verified" as const,
      sessionToken,
      expiresAt: sessionExpiresAt,
      requestId: link.request_id,
      email: link.email,
    };
  });
}

export async function withGuestSession<T>(
  sessionToken: string,
  fn: (context: {
    tenantId: string;
    guestLinkId: string;
    requestId: string;
    email: string;
  }) => Promise<T>,
): Promise<T | { kind: "invalid_session" }> {
  const scoped = parseScopedToken(sessionToken);
  if (!scoped) return { kind: "invalid_session" };

  const context = await withTenantTransaction(scoped.tenantId, async (client) => {
    const result = await client.query<{
      guest_link_id: string;
      request_id: string;
      email: string;
      session_expires_at: Date;
      session_revoked_at: Date | null;
      link_expires_at: Date;
      link_revoked_at: Date | null;
    }>(
      `SELECT gs.guest_link_id, gl.request_id, gl.email,
              gs.expires_at AS session_expires_at,
              gs.revoked_at AS session_revoked_at,
              gl.expires_at AS link_expires_at,
              gl.revoked_at AS link_revoked_at
         FROM guest_sessions gs
         JOIN guest_links gl ON gl.id = gs.guest_link_id
        WHERE gs.session_token_hash = $1
        LIMIT 1`,
      [hash(sessionToken)],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.session_revoked_at ||
      row.link_revoked_at ||
      row.session_expires_at.getTime() <= Date.now() ||
      row.link_expires_at.getTime() <= Date.now()
    ) {
      return null;
    }
    return {
      tenantId: scoped.tenantId,
      guestLinkId: row.guest_link_id,
      requestId: row.request_id,
      email: row.email,
    };
  });

  if (!context) return { kind: "invalid_session" };
  return fn(context);
}
