import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { importXlsx } from "./import.service.js";

export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/requests/:id/imports/xlsx", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const file = await request.file();
    if (!file) return reply.code(400).send({ message: "Arquivo XLSX obrigatório." });

    const filename = file.filename.toLowerCase();
    if (!filename.endsWith(".xlsx")) {
      return reply.code(415).send({ message: "Apenas arquivos .xlsx são aceitos." });
    }

    const buffer = await file.toBuffer();
    const result = await importXlsx({
      tenantId: request.user.tenantId,
      requestId: params.id,
      actorUserId: request.user.sub,
      filename: file.filename,
      mimeType: file.mimetype,
      buffer,
    });

    switch (result.kind) {
      case "file_too_large": return reply.code(413).send({ message: "Arquivo excede 20 MB." });
      case "not_found": return reply.code(404).send({ message: "Solicitação não encontrada." });
      case "forbidden": return reply.code(403).send({ message: "Sem permissão para importar." });
      case "invalid_state": return reply.code(409).send({ message: "Estado não permite importação.", status: result.status });
      case "missing_template": return reply.code(422).send({ message: "Solicitação precisa estar vinculada a um modelo publicado." });
      case "empty_workbook": return reply.code(422).send({ message: "Planilha sem worksheet." });
      case "too_many_rows": return reply.code(422).send({ message: "Limite de 10.000 linhas excedido." });
      case "too_many_columns": return reply.code(422).send({ message: "Limite de 200 colunas excedido." });
      case "completed": return reply.code(200).send(result);
    }
  });
}
