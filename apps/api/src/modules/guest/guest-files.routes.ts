import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  guestConfirmXlsx,
  guestUploadEvidence,
  guestValidateXlsx,
} from "./guest-files.service.js";

function bearer(value: string | undefined): string | null {
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice("Bearer ".length).trim();
}

export async function guestFileRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/guest/imports/xlsx", async (request, reply) => {
    const sessionToken = bearer(request.headers.authorization);
    if (!sessionToken) return reply.code(401).send({ message: "Sessão de convidado ausente." });

    const file = await request.file();
    if (!file) return reply.code(400).send({ message: "Arquivo XLSX obrigatório." });
    if (!file.filename.toLowerCase().endsWith(".xlsx")) {
      return reply.code(415).send({ message: "Apenas arquivos .xlsx são aceitos." });
    }

    const result = await guestValidateXlsx({
      sessionToken,
      filename: file.filename,
      mimeType: file.mimetype,
      buffer: await file.toBuffer(),
    });

    if (result.kind === "invalid_session") return reply.code(401).send({ message: "Sessão inválida." });
    if (result.kind === "file_too_large") return reply.code(413).send({ message: "Arquivo excede 20 MB." });
    if (result.kind === "malware_detected") return reply.code(422).send({ message: "Arquivo rejeitado pelo antivírus.", signature: result.signature });
    if (result.kind === "antivirus_unavailable") return reply.code(503).send({ message: "Antivírus indisponível." });
    if (result.kind === "not_found") return reply.code(404).send({ message: "Solicitação não encontrada." });
    if (result.kind === "invalid_state") return reply.code(409).send({ message: "Estado não permite importação.", status: result.status });
    if (result.kind === "missing_template") return reply.code(422).send({ message: "Solicitação sem modelo publicado." });
    if (result.kind === "empty_workbook") return reply.code(422).send({ message: "Planilha vazia." });
    if (result.kind === "too_many_rows") return reply.code(422).send({ message: "Limite de 10.000 linhas excedido." });
    if (result.kind === "too_many_columns") return reply.code(422).send({ message: "Limite de 200 colunas excedido." });
    if (result.kind === "storage_limit") return reply.code(409).send({
      message: result.reason === "billing_inactive"
        ? "Plano do tenant está suspenso ou cancelado."
        : "Limite de armazenamento do plano atingido.",
      usedBytes: result.usedBytes,
      limitBytes: result.limitBytes,
    });
    return reply.send(result);
  });

  app.post("/v1/guest/imports/:importId/confirm", async (request, reply) => {
    const sessionToken = bearer(request.headers.authorization);
    if (!sessionToken) return reply.code(401).send({ message: "Sessão de convidado ausente." });
    const params = z.object({ importId: z.string().uuid() }).parse(request.params);

    const result = await guestConfirmXlsx({ sessionToken, importId: params.importId });
    if (result.kind === "invalid_session") return reply.code(401).send({ message: "Sessão inválida." });
    if (result.kind === "not_found") return reply.code(404).send({ message: "Importação não encontrada." });
    if (result.kind === "forbidden") return reply.code(403).send({ message: "Importação pertence a outro convidado." });
    if (result.kind === "invalid_state") return reply.code(409).send({ message: "Importação não está validada." });
    if (result.kind === "already_confirmed") return reply.send({ confirmed: true, changed: false });
    return reply.send({ confirmed: true, changed: true, importedRows: result.importedRows });
  });

  app.post("/v1/guest/evidence", async (request, reply) => {
    const sessionToken = bearer(request.headers.authorization);
    if (!sessionToken) return reply.code(401).send({ message: "Sessão de convidado ausente." });

    const file = await request.file();
    if (!file) return reply.code(400).send({ message: "Arquivo obrigatório." });
    const fields = file.fields as Record<string, { value?: string }>;
    const itemId = fields.itemId?.value;

    const result = await guestUploadEvidence({
      sessionToken,
      ...(itemId ? { itemId } : {}),
      filename: file.filename,
      mimeType: file.mimetype,
      buffer: await file.toBuffer(),
    });

    if (result.kind === "invalid_session") return reply.code(401).send({ message: "Sessão inválida." });
    if (result.kind === "file_too_large") return reply.code(413).send({ message: "Arquivo excede 20 MB." });
    if (result.kind === "malware_detected") return reply.code(422).send({ message: "Arquivo rejeitado pelo antivírus.", signature: result.signature });
    if (result.kind === "antivirus_unavailable") return reply.code(503).send({ message: "Antivírus indisponível." });
    if (result.kind === "not_found") return reply.code(404).send({ message: "Solicitação não encontrada." });
    if (result.kind === "item_not_found") return reply.code(404).send({ message: "Item não encontrado." });
    if (result.kind === "invalid_state") return reply.code(409).send({ message: "Estado não permite evidência.", status: result.status });
    if (result.kind === "storage_limit") return reply.code(409).send({
      message: result.reason === "billing_inactive"
        ? "Plano do tenant está suspenso ou cancelado."
        : "Limite de armazenamento do plano atingido.",
      usedBytes: result.usedBytes,
      limitBytes: result.limitBytes,
    });
    return reply.code(201).send(result.attachment);
  });
}
