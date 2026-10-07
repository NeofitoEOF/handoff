import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  extractXlsxHeaders,
  listImportMappings,
  saveImportMapping,
  suggestImportMapping,
} from "./import-mapping.service.js";

export async function importMappingRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/templates/:templateId/import-mappings",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z.object({ templateId: z.string().uuid() }).parse(request.params);
      const result = await listImportMappings({
        tenantId: request.user.tenantId,
        actorUserId: request.user.sub,
        templateId: params.templateId,
      });
      if (result.kind === "forbidden_or_not_found") {
        return reply.code(404).send({ message: "Modelo não encontrado ou sem acesso." });
      }
      return reply.send({ data: result.mappings });
    },
  );

  app.post(
    "/v1/templates/:templateId/import-mappings/suggest",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z.object({ templateId: z.string().uuid() }).parse(request.params);
      const file = await request.file();
      if (!file) return reply.code(400).send({ message: "Arquivo XLSX obrigatório." });
      if (!file.filename.toLowerCase().endsWith(".xlsx")) {
        return reply.code(415).send({ message: "Apenas arquivos .xlsx são aceitos." });
      }

      const headers = await extractXlsxHeaders(await file.toBuffer());
      if (headers.kind === "file_too_large") return reply.code(413).send({ message: "Arquivo excede 20 MB." });
      if (headers.kind === "malware_detected") return reply.code(422).send({ message: "Arquivo rejeitado pelo antivírus.", signature: headers.signature });
      if (headers.kind === "antivirus_unavailable") return reply.code(503).send({ message: "Antivírus indisponível." });
      if (headers.kind === "empty_workbook") return reply.code(422).send({ message: "Planilha vazia." });
      if (headers.kind === "too_many_columns") return reply.code(422).send({ message: "Limite de 200 colunas excedido." });

      const result = await suggestImportMapping({
        tenantId: request.user.tenantId,
        actorUserId: request.user.sub,
        templateId: params.templateId,
        headers: headers.headers,
      });
      if (result.kind === "not_found") return reply.code(404).send({ message: "Modelo não encontrado." });
      if (result.kind === "forbidden") return reply.code(403).send({ message: "Somente Gestor pode sugerir mapeamento." });

      return reply.send({
        headers: headers.headers,
        fields: result.fields,
        mapping: result.mapping,
        confidence: result.confidence,
      });
    },
  );

  app.put(
    "/v1/templates/:templateId/import-mappings/:name",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z.object({
        templateId: z.string().uuid(),
        name: z.string().trim().min(1).max(100),
      }).parse(request.params);
      const body = z.object({
        mapping: z.record(z.string(), z.string().min(1)),
        sourceHeaders: z.array(z.string().min(1)).max(200),
      }).parse(request.body);

      const result = await saveImportMapping({
        tenantId: request.user.tenantId,
        actorUserId: request.user.sub,
        templateId: params.templateId,
        name: params.name,
        mapping: body.mapping,
        sourceHeaders: body.sourceHeaders,
      });
      if (result.kind === "not_found") return reply.code(404).send({ message: "Modelo não encontrado." });
      if (result.kind === "forbidden") return reply.code(403).send({ message: "Somente Gestor pode salvar mapeamento." });
      return reply.send(result.mapping);
    },
  );
}
