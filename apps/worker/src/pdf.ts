import crypto from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "./config.js";

const storage = new S3Client({
  endpoint: config.OBJECT_STORAGE_ENDPOINT,
  region: config.OBJECT_STORAGE_REGION,
  forcePathStyle: config.OBJECT_STORAGE_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: config.OBJECT_STORAGE_ACCESS_KEY,
    secretAccessKey: config.OBJECT_STORAGE_SECRET_KEY,
  },
});

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return escapeHtml(JSON.stringify(value));
  return escapeHtml(value);
}

export function renderClosureHtml(snapshot: Record<string, unknown>): string {
  const request = (snapshot.request ?? {}) as Record<string, unknown>;
  const items = Array.isArray(snapshot.items)
    ? snapshot.items as Array<Record<string, unknown>>
    : [];

  const rows = items.map((item) => {
    const data = item.data && typeof item.data === "object"
      ? item.data as Record<string, unknown>
      : {};
    return `
      <tr>
        <td>${escapeHtml(item.item_key)}</td>
        <td><pre>${renderValue(data)}</pre></td>
        <td>${escapeHtml(item.status)}</td>
        <td>${escapeHtml(item.submitted_by)}</td>
        <td>${escapeHtml(item.reviewed_by)}</td>
      </tr>`;
  }).join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; color: #222; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .meta { margin-bottom: 20px; }
  .meta div { margin: 3px 0; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #ccc; padding: 6px; vertical-align: top; word-break: break-word; }
  th { background: #f3f3f3; text-align: left; }
  pre { white-space: pre-wrap; margin: 0; font: inherit; }
  .footer { margin-top: 20px; font-size: 10px; color: #666; }
</style>
</head>
<body>
  <h1>Fechamento — ${escapeHtml(request.title)}</h1>
  <div class="meta">
    <div><strong>Solicitação:</strong> ${escapeHtml(request.id)}</div>
    <div><strong>Competência:</strong> ${escapeHtml(request.competence)}</div>
    <div><strong>Prazo:</strong> ${escapeHtml(request.due_at)}</div>
    <div><strong>Fechado por:</strong> ${escapeHtml(snapshot.closedBy)}</div>
    <div><strong>Fechado em:</strong> ${escapeHtml(snapshot.closedAt)}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:15%">Item</th>
        <th style="width:45%">Dados aprovados</th>
        <th style="width:10%">Status</th>
        <th style="width:15%">Enviado por</th>
        <th style="width:15%">Revisado por</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">
    Documento gerado automaticamente pelo Handoff a partir do snapshot imutável aprovado.
  </div>
</body>
</html>`;
}

export async function generatePdf(html: string): Promise<Buffer> {
  const form = new FormData();
  form.append(
    "files",
    new Blob([html], { type: "text/html; charset=utf-8" }),
    "index.html",
  );

  const response = await fetch(
    `${config.GOTENBERG_URL.replace(/\/$/, "")}/forms/chromium/convert/html`,
    { method: "POST", body: form },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Gotenberg HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function storePdf(input: {
  tenantId: string;
  requestId: string;
  pdf: Buffer;
}): Promise<{ storageKey: string; sha256: string }> {
  const sha256 = crypto.createHash("sha256").update(input.pdf).digest("hex");
  const storageKey = `${input.tenantId}/${input.requestId}/closure/${sha256}.pdf`;

  await storage.send(new PutObjectCommand({
    Bucket: config.OBJECT_STORAGE_BUCKET,
    Key: storageKey,
    Body: input.pdf,
    ContentType: "application/pdf",
  }));

  return { storageKey, sha256 };
}
