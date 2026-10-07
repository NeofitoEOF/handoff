import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createTemplate,
  createTemplateVersion,
  listTemplates,
  publishTemplateVersion,
} from "./template.service.js";

const fieldSchema = z.object({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(160),
  type: z.enum(["TEXT", "NUMBER", "MONEY", "DATE", "CPF", "CNPJ", "SELECT", "BOOLEAN", "ATTACHMENT"]),
  required: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  regex: z.string().max(500).optional(),
  options: z.array(z.string().max(200)).max(500).optional(),
});
const schemaSchema = z.object({ fields: z.array(fieldSchema).min(1).max(200) });

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/sectors/:sectorId/templates", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ sectorId: z.string().uuid() }).parse(request.params);
    const result = await listTemplates({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      sectorId: params.sectorId,
    });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Sem acesso ao setor." });
    return reply.send({ data: result.templates });
  });

  app.post("/v1/sectors/:sectorId/templates", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ sectorId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      name: z.string().trim().min(2).max(160),
      description: z.string().trim().max(2000).optional(),
      schema: schemaSchema,
    }).parse(request.body);

    const result = await createTemplate({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      sectorId: params.sectorId,
      name: body.name,
      ...(body.description ? { description: body.description } : {}),
      schema: body.schema,
    });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Somente Gestor do setor pode criar modelo." });
    return reply.code(201).send(result.version);
  });

  app.post("/v1/templates/:templateId/versions", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ templateId: z.string().uuid() }).parse(request.params);
    const body = z.object({ schema: schemaSchema }).parse(request.body);
    const result = await createTemplateVersion({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      templateId: params.templateId,
      schema: body.schema,
    });
    if (result.kind === "not_found") return reply.code(404).send({ message: "Modelo não encontrado." });
    if (result.kind === "inactive") return reply.code(409).send({ message: "Modelo está inativo." });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Somente Gestor pode versionar modelo." });
    return reply.code(201).send(result.version);
  });

  app.post("/v1/templates/:templateId/versions/:versionId/publish", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({
      templateId: z.string().uuid(),
      versionId: z.string().uuid(),
    }).parse(request.params);
    const result = await publishTemplateVersion({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      templateId: params.templateId,
      versionId: params.versionId,
    });

    switch (result.kind) {
      case "not_found":
      case "version_not_found": return reply.code(404).send({ message: "Modelo/versão não encontrado." });
      case "forbidden": return reply.code(403).send({ message: "Somente Gestor pode publicar." });
      case "already_published": return reply.code(200).send({ published: true, changed: false });
      case "published": return reply.code(200).send({ published: true, changed: true });
    }
  });
}
