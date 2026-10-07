import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { acceptInvitation, createInvitation } from "./invitation.service.js";
import { config } from "../../config.js";

export async function invitationRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/sectors/:sectorId/invitations",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z.object({ sectorId: z.string().uuid() }).parse(request.params);
      const body = z.object({
        email: z.string().email(),
        role: z.enum(["MANAGER", "APPROVER", "MEMBER"]),
      }).parse(request.body);

      const result = await createInvitation({
        tenantId: request.user.tenantId,
        actorUserId: request.user.sub,
        sectorId: params.sectorId,
        email: body.email,
        role: body.role,
      });

      switch (result.kind) {
        case "forbidden": return reply.code(403).send({ message: "Sem permissão para convidar neste setor." });
        case "cannot_grant_manager": return reply.code(403).send({ message: "Somente Admin da Empresa pode convidar Gestor." });
        case "sector_not_found": return reply.code(404).send({ message: "Setor não encontrado." });
        case "sector_inactive": return reply.code(409).send({ message: "Setor está inativo." });
        case "created":
          return reply.code(201).send({
            invitationId: result.invitationId,
            expiresAt: result.expiresAt,
            ...(config.NODE_ENV !== "production" ? { devInviteToken: result.token } : {}),
          });
      }
    },
  );

  app.post("/v1/invitations/accept", async (request, reply) => {
    const body = z.object({
      token: z.string().min(20),
      name: z.string().trim().min(2).max(160),
      password: z.string().min(12).max(200),
    }).parse(request.body);

    const result = await acceptInvitation(body);
    if (result.kind === "invalid_invitation") {
      return reply.code(410).send({ message: "Convite inválido, revogado ou expirado." });
    }
    return reply.code(200).send({
      accepted: true,
      tenantId: result.tenantId,
      userId: result.userId,
      sectorId: result.sectorId,
      role: result.role,
    });
  });
}
