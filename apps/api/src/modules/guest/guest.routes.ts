import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { createGuestLink, issueGuestOtp, verifyGuestOtp } from "./guest.service.js";
import { getGuestRequest, saveGuestItem, submitGuestResponse } from "./guest-response.service.js";

function bearerToken(value: string | undefined): string | null {
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice("Bearer ".length).trim();
}

export async function guestRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/requests/:id/guest-links",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z.object({ email: z.string().email() }).parse(request.body);

      const result = await createGuestLink({
        tenantId: request.user.tenantId,
        actorUserId: request.user.sub,
        requestId: params.id,
        email: body.email,
      });

      switch (result.kind) {
        case "not_found": return reply.code(404).send({ message: "Solicitação não encontrada." });
        case "forbidden": return reply.code(403).send({ message: "Somente Gestor do setor de destino pode criar link de convidado." });
        case "invalid_state": return reply.code(409).send({ message: "Estado não permite convidado.", status: result.status });
        case "expired_request": return reply.code(409).send({ message: "Solicitação já venceu; ajuste o prazo antes de convidar." });
        case "created":
          return reply.code(201).send({
            guestLinkId: result.guestLinkId,
            expiresAt: result.expiresAt,
            ...(config.NODE_ENV !== "production" ? { devLinkToken: result.token } : {}),
          });
      }
    },
  );

  app.post("/v1/guest/request-otp", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const body = z.object({ linkToken: z.string().min(40) }).parse(request.body);
    const result = await issueGuestOtp(body.linkToken);

    if (result.kind === "invalid_link") {
      return reply.code(410).send({ message: "Link inválido, revogado ou expirado." });
    }

    return reply.code(202).send({
      sent: true,
      expiresAt: result.expiresAt,
      ...(config.NODE_ENV !== "production" ? { devOtp: result.otp } : {}),
    });
  });

  app.post("/v1/guest/verify-otp", async (request, reply) => {
    const body = z.object({
      linkToken: z.string().min(40),
      otp: z.string().regex(/^\d{6}$/),
    }).parse(request.body);

    const result = await verifyGuestOtp(body);
    switch (result.kind) {
      case "invalid_link": return reply.code(410).send({ message: "Link inválido ou expirado." });
      case "otp_expired": return reply.code(410).send({ message: "Código expirado. Solicite outro." });
      case "otp_locked": return reply.code(429).send({ message: "Limite de tentativas excedido. Solicite outro código." });
      case "invalid_otp": return reply.code(401).send({ message: "Código inválido.", attemptsRemaining: result.attemptsRemaining });
      case "verified":
        return reply.send({
          sessionToken: result.sessionToken,
          expiresAt: result.expiresAt,
          requestId: result.requestId,
        });
    }
  });

  app.get("/v1/guest/request", async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    if (!token) return reply.code(401).send({ message: "Sessão de convidado ausente." });

    const result = await getGuestRequest(token);
    if ("kind" in result && result.kind === "invalid_session") {
      return reply.code(401).send({ message: "Sessão de convidado inválida ou expirada." });
    }
    return reply.send(result);
  });

  app.put("/v1/guest/items/:itemKey", async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    if (!token) return reply.code(401).send({ message: "Sessão de convidado ausente." });

    const params = z.object({ itemKey: z.string().trim().min(1).max(120) }).parse(request.params);
    const body = z.object({ data: z.record(z.string(), z.unknown()) }).parse(request.body);

    const result = await saveGuestItem({
      sessionToken: token,
      itemKey: params.itemKey,
      data: body.data,
    });

    if ("kind" in result && result.kind === "invalid_session") {
      return reply.code(401).send({ message: "Sessão de convidado inválida." });
    }
    if (result.kind === "not_found") return reply.code(404).send({ message: "Solicitação não encontrada." });
    if (result.kind === "invalid_state") return reply.code(409).send({ message: "Estado não permite edição.", status: result.status });
    if (result.kind === "item_locked") return reply.code(409).send({ message: "Item está bloqueado." });
    if (result.kind === "field_locked") return reply.code(422).send({ message: "Há campos ocultos ou somente leitura para convidado.", fields: result.fields });
    return reply.send(result.item);
  });

  app.post("/v1/guest/submit", async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    if (!token) return reply.code(401).send({ message: "Sessão de convidado ausente." });

    const result = await submitGuestResponse(token);
    if ("kind" in result && result.kind === "invalid_session") {
      return reply.code(401).send({ message: "Sessão de convidado inválida." });
    }
    if (result.kind === "not_found") return reply.code(404).send({ message: "Solicitação não encontrada." });
    if (result.kind === "invalid_state") return reply.code(409).send({ message: "Estado não permite submissão.", status: result.status });
    if (result.kind === "nothing_to_submit") return reply.code(422).send({ message: "Não há itens para submeter." });
    return reply.send({ submitted: true });
  });
}
