import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { createRefreshSession } from "../identity/identity.service.js";
import {
  completeMicrosoftCallback,
  configureMicrosoftIntegration,
  consumeMicrosoftTicket,
  getMicrosoftIntegration,
  startMicrosoftLogin,
} from "./microsoft.service.js";

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

export async function microsoftRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/auth/microsoft/start", async (request, reply) => {
    const query = z.object({
      subdomain: z.string().trim().regex(/^[a-z0-9-]{3,63}$/),
    }).parse(request.query);

    try {
      const result = await startMicrosoftLogin(query.subdomain);
      if (result.kind === "tenant_not_found") {
        return reply.code(404).send({ message: "Empresa não encontrada." });
      }
      if (result.kind === "not_enabled") {
        return reply.code(409).send({ message: "Login Microsoft não está habilitado para a empresa." });
      }
      return reply.send({ authorizeUrl: result.authorizeUrl });
    } catch (error) {
      if (error instanceof Error && error.message.includes("not configured")) {
        return reply.code(503).send({ message: "Integração Microsoft não configurada no ambiente." });
      }
      throw error;
    }
  });

  app.get("/v1/auth/microsoft/callback", async (request, reply) => {
    const query = z.object({
      code: z.string().min(1).optional(),
      state: z.string().min(20).optional(),
      error: z.string().optional(),
      error_description: z.string().optional(),
    }).parse(request.query);

    if (query.error || !query.code || !query.state) {
      const params = new URLSearchParams({
        error: query.error ?? "microsoft_callback_error",
      });
      return reply.redirect(`${config.APP_BASE_URL}/microsoft/callback?${params.toString()}`);
    }

    try {
      const result = await completeMicrosoftCallback({
        code: query.code,
        state: query.state,
      });

      if (result.kind !== "ok") {
        return reply.redirect(
          `${config.APP_BASE_URL}/microsoft/callback?error=${encodeURIComponent(result.kind)}`,
        );
      }

      return reply.redirect(
        `${config.APP_BASE_URL}/microsoft/callback?ticket=${encodeURIComponent(result.ticket)}`,
      );
    } catch {
      return reply.redirect(
        `${config.APP_BASE_URL}/microsoft/callback?error=microsoft_verification_failed`,
      );
    }
  });

  app.post(
    "/v1/auth/microsoft/exchange",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = z.object({ ticket: z.string().min(20) }).parse(request.body);
      const result = await consumeMicrosoftTicket(body.ticket);
      if (result.kind !== "ok") {
        return reply.code(401).send({ message: "Ticket Microsoft inválido ou expirado." });
      }

      const refresh = await createRefreshSession({
        tenantId: result.tenantId,
        userId: result.userId,
        ...(request.headers["user-agent"] ? { userAgent: request.headers["user-agent"] } : {}),
        ip: request.ip,
      });
      const accessToken = app.jwt.sign(
        { sub: result.userId, tenantId: result.tenantId },
        { expiresIn: "15m" },
      );

      reply.setCookie(refreshCookieName, refresh.token, refreshCookieOptions(refresh.expiresAt));
      return reply.send({ accessToken, expiresIn: 900 });
    },
  );

  app.get(
    "/v1/admin/integrations/microsoft",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const result = await getMicrosoftIntegration({
        tenantId: request.user.tenantId,
        actorUserId: request.user.sub,
      });
      if (result.kind === "forbidden") {
        return reply.code(403).send({ message: "Somente Admin da Empresa pode ver a integração." });
      }
      return reply.send(result.integration);
    },
  );

  app.put(
    "/v1/admin/integrations/microsoft",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = z.object({
        entraTenantId: z.string().uuid(),
        enabled: z.boolean().default(true),
      }).parse(request.body);

      const result = await configureMicrosoftIntegration({
        tenantId: request.user.tenantId,
        actorUserId: request.user.sub,
        entraTenantId: body.entraTenantId,
        enabled: body.enabled,
      });
      if (result.kind === "forbidden") {
        return reply.code(403).send({ message: "Somente Admin da Empresa pode configurar Microsoft." });
      }
      return reply.send({ saved: true });
    },
  );
}
