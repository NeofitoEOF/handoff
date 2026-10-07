import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createTemplate,
  createTemplateVersion,
  getTemplateDetail,
  listTemplates,
  publishTemplateVersion,
  updateDraftTemplateVersion,
} from "./template.service.js";
import { cloneLibraryTemplate, listTemplateLibrary } from "./template-library.service.js";
import { inferTemplateFromXlsx } from "./template-inference.service.js";

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
  app.get("/v1/template-library", { preHandler: app.authenticate }, async () => {
    return { data: await listTemplateLibrary() };
  });

  app.post(
    "/v1/sectors/:sectorId/templates/clone-library/:libraryId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z.object({
        sectorId: z.string().uuid(),
        libraryId: z.string().uuid(),
      }).parse(request.params);
      const body = z.object({
        name: z.string().trim().min(2).max(160).optional(),
      }).parse(request.body ?? {});

      const result = await cloneLibraryTemplate({
        tenantId: request.user.tenantId,
        actorUserId: request.user.sub,
        sectorId: params.sectorId,
        libraryId: params.libraryId,
        ...(body.name ? { name: body.name } : {}),
      });

      if (result.kind === "forbidden") return reply.code(403).send({ message: "Somente Gestor pode clonar modelo." });
      if (result.kind === "not_found") return reply.code(404).send({ message: "Modelo da biblioteca não encontrado." });
      return reply.code(201).send(result.version);
    },
  );

  app.post(
    "/v1/sectors/:sectorId/templates/from-xlsx",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z.object({ sectorId: z.string().uuid() }).parse(request.params);
      const file = await request.file();
      if (!file) return reply.code(400).send({ message: "Arquivo XLSX obrigatório." });
      if (!file.filename.toLowerCase().endsWith(".xlsx")) {
        return reply.code(415).send({ message: "Apenas arquivos .xlsx são aceitos." });
      }

      const inferred = await inferTemplateFromXlsx(await file.toBuffer());
      if (inferred.kind === "file_too_large") return reply.code(413).send({ message: "Arquivo excede 20 MB." });
      if (inferred.kind === "empty_workbook") return reply.code(422).send({ message: "Planilha sem worksheet." });
      if (inferred.kind === "too_many_columns") return reply.code(422).send({ message: "Limite de 200 colunas excedido." });
      if (inferred.kind === "no_headers") return reply.code(422).send({ message: "Cabeçalhos não encontrados na primeira linha." });

      const name = file.filename.replace(/\.xlsx$/i, "").slice(0, 160) || "Modelo importado";
      const created = await createTemplate({
        tenantId: request.user.tenantId,
        actorUserId: request.user.sub,
        sectorId: params.sectorId,
        name,
        description: "Modelo inferido a partir de planilha enviada.",
        schema: inferred.schema,
      });

      if (created.kind === "forbidden") {
        return reply.code(403).send({ message: "Somente Gestor do setor pode criar modelo." });
      }

      return reply.code(201).send({
        version: created.version,
        inference: {
          sampleRows: inferred.sampleRows,
          schema: inferred.schema,
        },
      });
    },
  );
  app.get("/v1/templates/:templateId", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ templateId: z.string().uuid() }).parse(request.params);
    const result = await getTemplateDetail({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
      templateId: params.templateId,
    });
    if (result.kind === "not_found") return reply.code(404).send({ message: "Modelo não encontrado." });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Sem acesso ao modelo." });
    return reply.send({ template: result.template, versions: result.versions });
  });

  app.patch(
    "/v1/templates/:templateId/versions/:versionId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z.object({
        templateId: z.string().uuid(),
        versionId: z.string().uuid(),
      }).parse(request.params);
      const body = z.object({ schema: schemaSchema }).parse(request.body);

      const result = await updateDraftTemplateVersion({
        tenantId: request.user.tenantId,
        actorUserId: request.user.sub,
        templateId: params.templateId,
        versionId: params.versionId,
        schema: body.schema,
      });

      switch (result.kind) {
        case "not_found":
        case "version_not_found":
          return reply.code(404).send({ message: "Modelo/versão não encontrado." });
        case "forbidden":
          return reply.code(403).send({ message: "Somente Gestor pode editar o rascunho." });
        case "immutable":
          return reply.code(409).send({ message: "Versão publicada é imutável." });
        case "updated":
          return reply.send(result.version);
      }
    },
  );

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
