import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uploadEvidence } from "./evidence.service.js";

export async function evidenceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/requests/:id/evidence", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const file = await request.file();
    if (!file) return reply.code(400).send({ message: "Arquivo obrigatório." });

    const fields = file.fields as Record<string, { value?: string }>;
    const itemId = fields.itemId?.value;

    const result = await uploadEvidence({
      tenantId: request.user.tenantId,
      requestId: params.id,
      actorUserId: request.user.sub,
      ...(itemId ? { itemId } : {}),
      filename: file.filename,
      mimeType: file.mimetype,
      buffer: await file.toBuffer(),
    });

    switch (result.kind) {
      case "file_too_large": return reply.code(413).send({ message: "Arquivo excede 20 MB." });
      case "malware_detected": return reply.code(422).send({ message: "Arquivo rejeitado pelo antivírus.", signature: result.signature });
      case "antivirus_unavailable": return reply.code(503).send({ message: "Antivírus indisponível. O arquivo não foi persistido." });
      case "not_found": return reply.code(404).send({ message: "Solicitação não encontrada." });
      case "item_not_found": return reply.code(404).send({ message: "Item não pertence à solicitação." });
      case "forbidden": return reply.code(403).send({ message: "Sem acesso à solicitação." });
      case "invalid_state": return reply.code(409).send({ message: "Estado não permite novos anexos.", status: result.status });
      case "uploaded": return reply.code(201).send(result.attachment);
    }
  });
}
