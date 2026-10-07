import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { addSectorMember, createSector, listSectors } from "./sector.service.js";

const sectorParams = z.object({ id: z.string().uuid() });

export async function sectorRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/sectors", { preHandler: app.authenticate }, async (request) => {
    return { data: await listSectors(request.user.tenantId) };
  });

  app.post("/v1/sectors", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({ name: z.string().trim().min(2).max(120) }).parse(request.body);
    const result = await createSector({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      name: body.name,
    });

    if (result.kind === "forbidden") {
      return reply.code(403).send({ message: "Somente Admin da Empresa pode criar setores." });
    }

    return reply.code(201).send(result.sector);
  });

  app.post("/v1/sectors/:id/members", { preHandler: app.authenticate }, async (request, reply) => {
    const params = sectorParams.parse(request.params);
    const body = z.object({
      userId: z.string().uuid(),
      role: z.enum(["MANAGER", "APPROVER", "MEMBER"]),
    }).parse(request.body);

    const result = await addSectorMember({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      sectorId: params.id,
      userId: body.userId,
      role: body.role,
    });

    switch (result.kind) {
      case "sector_not_found":
        return reply.code(404).send({ message: "Setor não encontrado." });
      case "sector_inactive":
        return reply.code(409).send({ message: "Setor está inativo." });
      case "forbidden":
        return reply.code(403).send({ message: "Sem permissão para gerenciar este setor." });
      case "cannot_grant_manager":
        return reply.code(403).send({ message: "Somente Admin da Empresa pode nomear Gestor." });
      case "user_not_in_tenant":
        return reply.code(422).send({ message: "Usuário não pertence à empresa." });
      case "saved":
        return reply.code(200).send(result.membership);
    }
  });
}
