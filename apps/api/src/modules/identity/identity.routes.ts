import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  authenticatePassword,
  createRefreshSession,
  revokeRefreshToken,
  rotateRefreshSession,
} from "./identity.service.js";
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
    }).parse(request.body);

    const auth = await authenticatePassword(body);
    if (auth.kind !== "ok") {
      return reply.code(401).send({ message: "Credenciais inválidas." });
    }

    const refresh = await createRefreshSession({
      tenantId: body.tenantId,
      userId: auth.user.id,
      userAgent: request.headers["user-agent"],
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
}
