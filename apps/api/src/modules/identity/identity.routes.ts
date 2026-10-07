import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  authenticatePassword,
  createRefreshSession,
  revokeRefreshToken,
  rotateRefreshSession,
} from "./identity.service.js";
import { confirmMfa, disableMfa, setupMfa, verifyMfaForLogin } from "./mfa.service.js";
import { consumePasswordReset, createPasswordReset } from "./password-reset.service.js";
import { config } from "../../config.js";

const refreshCookieName = "handoff_refresh";

function refreshCookieOptions(expires: Date) {
  return {
    path: "/v1/auth",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: config.NODE_ENV === "production",
    expires,
  };
}

export async function identityRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/auth/login", async (request, reply) => {
    const body = z.object({
      tenantId: z.string().uuid(),
      email: z.string().email(),
      password: z.string().min(8).max(200),
      otp: z.string().regex(/^\d{6}$/).optional(),
    }).parse(request.body);

    const auth = await authenticatePassword(body);
    if (auth.kind !== "ok") {
      return reply.code(401).send({ message: "Credenciais inválidas." });
    }

    const mfa = await verifyMfaForLogin(auth.user.id, body.otp);
    if (mfa.kind === "required") {
      return reply.code(428).send({ message: "MFA obrigatório.", code: "MFA_REQUIRED" });
    }
    if (mfa.kind === "invalid") {
      return reply.code(401).send({ message: "Código MFA inválido." });
    }

    const refresh = await createRefreshSession({
      tenantId: body.tenantId,
      userId: auth.user.id,
      ...(request.headers["user-agent"] ? { userAgent: request.headers["user-agent"] } : {}),
      ip: request.ip,
    });

    const accessToken = app.jwt.sign(
      { sub: auth.user.id, tenantId: body.tenantId },
      { expiresIn: "15m" },
    );

    reply.setCookie(refreshCookieName, refresh.token, refreshCookieOptions(refresh.expiresAt));
    return reply.send({
      accessToken,
      expiresIn: 900,
      user: auth.user,
    });
  });

  app.post("/v1/auth/refresh", async (request, reply) => {
    const token = request.cookies[refreshCookieName];
    if (!token) return reply.code(401).send({ message: "Refresh token ausente." });

    const rotated = await rotateRefreshSession({
      token,
      userAgent: request.headers["user-agent"],
      ip: request.ip,
    });

    if (rotated.kind !== "rotated") {
      reply.clearCookie(refreshCookieName, { path: "/v1/auth" });
      return reply.code(401).send({ message: "Refresh token inválido." });
    }

    const accessToken = app.jwt.sign(
      { sub: rotated.userId, tenantId: rotated.tenantId },
      { expiresIn: "15m" },
    );

    reply.setCookie(refreshCookieName, rotated.token, refreshCookieOptions(rotated.expiresAt));
    return reply.send({ accessToken, expiresIn: 900 });
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const token = request.cookies[refreshCookieName];
    if (token) await revokeRefreshToken(token);
    reply.clearCookie(refreshCookieName, { path: "/v1/auth" });
    return reply.code(204).send();
  });

  app.post("/v1/auth/password-reset/request", async (request, reply) => {
    const body = z.object({
      tenantId: z.string().uuid(),
      email: z.string().email(),
    }).parse(request.body);

    const result = await createPasswordReset(body);
    return reply.code(202).send({
      accepted: true,
      ...(config.NODE_ENV !== "production" && result.token
        ? { devResetToken: result.token, expiresAt: result.expiresAt }
        : {}),
    });
  });

  app.post("/v1/auth/password-reset/confirm", async (request, reply) => {
    const body = z.object({
      token: z.string().min(20),
      newPassword: z.string().min(12).max(200),
    }).parse(request.body);

    const result = await consumePasswordReset(body);
    if (result.kind === "invalid_token") {
      return reply.code(410).send({ message: "Token inválido ou expirado." });
    }
    return reply.code(200).send({ reset: true });
  });

  app.post("/v1/auth/mfa/setup", { preHandler: app.authenticate }, async (request, reply) => {
    const result = await setupMfa({
      tenantId: request.user.tenantId,
      userId: request.user.sub,
    });
    if (result.kind === "not_found") {
      return reply.code(404).send({ message: "Usuário não encontrado." });
    }
    return reply.code(200).send({
      secret: result.secret,
      otpauthUri: result.otpauthUri,
    });
  });

  app.post("/v1/auth/mfa/confirm", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({ otp: z.string().regex(/^\d{6}$/) }).parse(request.body);
    const result = await confirmMfa({
      tenantId: request.user.tenantId,
      userId: request.user.sub,
      token: body.otp,
    });
    if (result.kind === "not_setup") {
      return reply.code(409).send({ message: "MFA ainda não foi iniciado." });
    }
    if (result.kind === "invalid_token") {
      return reply.code(422).send({ message: "Código MFA inválido." });
    }
    return reply.code(200).send({ enabled: true });
  });

  app.post("/v1/auth/mfa/disable", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({ otp: z.string().regex(/^\d{6}$/) }).parse(request.body);
    const result = await disableMfa({
      tenantId: request.user.tenantId,
      userId: request.user.sub,
      token: body.otp,
    });
    if (result.kind === "not_enabled") {
      return reply.code(409).send({ message: "MFA não está habilitado." });
    }
    if (result.kind === "invalid_token") {
      return reply.code(422).send({ message: "Código MFA inválido." });
    }
    return reply.code(200).send({ enabled: false });
  });
}
