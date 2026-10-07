import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { DynamicFields } from "../components/DynamicFields";
import type { RequestDetail, RequestItem } from "../types";

type ImportPreview = {
  kind: "validated";
  importId: string;
  sha256: string;
  acceptedRows: number;
  rejectedRows: number;
  errors: Array<{ row: number; field: string; message: string }>;
};

type ClosureDocument = {
  id: string;
  status: "PENDING" | "PROCESSING" | "READY" | "FAILED";
  sha256: string | null;
  attempts: number;
  lastError: string | null;
  generatedAt: string | null;
  downloadUrl: string | null;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Operação não concluída.";
}

export function RequestPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const [itemKey, setItemKey] = useState("manual-1");
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [message, setMessage] = useState("");
  const [localError, setLocalError] = useState("");

  const detail = useQuery({
    queryKey: ["request", id],
    queryFn: () => api<RequestDetail>(`/v1/requests/${id}`),
    enabled: !!id,
  });

  const items = useQuery({
    queryKey: ["request-items", id],
    queryFn: () => api<{ data: RequestItem[] }>(`/v1/requests/${id}/items`),
    enabled: !!id,
  });

  const closure = useQuery({
    queryKey: ["closure-document", id],
    queryFn: () => api<ClosureDocument>(`/v1/requests/${id}/closure-document`),
    enabled: detail.data?.request.status === "CLOSED",
    retry: false,
  });

  const editableItem = useMemo(
    () => items.data?.data.find((item) => item.status === "RETURNED" || item.status === "DRAFT"),
    [items.data],
  );

  useEffect(() => {
    if (editableItem) {
      setItemKey(editableItem.item_key);
      setDraft(editableItem.data);
    }
  }, [editableItem?.id]);

  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["request", id] }),
      queryClient.invalidateQueries({ queryKey: ["request-items", id] }),
      queryClient.invalidateQueries({ queryKey: ["inbox"] }),
    ]);
  }

  const save = useMutation({
    mutationFn: () =>
      api<RequestItem>(`/v1/requests/${id}/items/${encodeURIComponent(itemKey)}`, {
        method: "PUT",
        body: JSON.stringify({ data: draft }),
      }),
    onSuccess: async () => {
      setMessage("Rascunho salvo.");
      setLocalError("");
      await refreshAll();
    },
    onError: (error) => setLocalError(errorMessage(error)),
  });

  const submit = useMutation({
    mutationFn: () => api(`/v1/requests/${id}/submit`, { method: "POST" }),
    onSuccess: async () => {
      setMessage("Resposta enviada para revisão.");
      setLocalError("");
      await refreshAll();
    },
    onError: (error) => setLocalError(errorMessage(error)),
  });

  const close = useMutation({
    mutationFn: () => api(`/v1/requests/${id}/close`, { method: "POST" }),
    onSuccess: async () => {
      setMessage("Solicitação fechada. O PDF está sendo gerado.");
      await refreshAll();
      await queryClient.invalidateQueries({ queryKey: ["closure-document", id] });
    },
    onError: (error) => setLocalError(errorMessage(error)),
  });

  async function approve(itemId: string) {
    setLocalError("");
    try {
      await api(`/v1/requests/${id}/items/${itemId}/approve`, { method: "POST" });
      setMessage("Item aprovado.");
      await refreshAll();
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  }

  async function returnItem(itemId: string) {
    const comment = window.prompt("Motivo da devolução:");
    if (!comment?.trim()) return;

    const defaultDue = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const date = window.prompt("Novo prazo de correção (AAAA-MM-DD):", defaultDue);
    if (!date) return;

    setLocalError("");
    try {
      await api(`/v1/requests/${id}/items/${itemId}/return`, {
        method: "POST",
        body: JSON.stringify({
          comment,
          correctionDueAt: new Date(`${date}T23:59:59`).toISOString(),
        }),
      });
      setMessage("Item devolvido para correção.");
      await refreshAll();
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  }

  async function uploadXlsx(file: File) {
    const form = new FormData();
    form.append("file", file);
    setLocalError("");
    setImportPreview(null);

    try {
      const preview = await api<ImportPreview>(`/v1/requests/${id}/imports/xlsx`, {
        method: "POST",
        body: form,
      });
      setImportPreview(preview);
      setMessage("Planilha validada. Confirme para gravar as linhas válidas.");
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  }

  async function confirmImport() {
    if (!importPreview) return;
    setLocalError("");
    try {
      await api(`/v1/requests/${id}/imports/${importPreview.importId}/confirm`, {
        method: "POST",
      });
      setMessage("Importação confirmada.");
      setImportPreview(null);
      await refreshAll();
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  }

  async function uploadEvidence(file: File, itemId?: string) {
    const form = new FormData();
    if (itemId) form.append("itemId", itemId);
    form.append("file", file);

    setLocalError("");
    try {
      await api(`/v1/requests/${id}/evidence`, { method: "POST", body: form });
      setMessage("Evidência anexada e verificada pelo antivírus.");
      await refreshAll();
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  }

  if (detail.isLoading || items.isLoading) return <p>Carregando solicitação...</p>;
  if (detail.error) return <div className="alert error">{detail.error.message}</div>;
  if (!detail.data) return <div className="alert error">Solicitação não encontrada.</div>;

  const { request, permissions } = detail.data;
  const schema = request.schema_json;
  const allItems = items.data?.data ?? [];

  return (
    <section>
      <div className="page-header">
        <div>
          <div className="eyebrow">{request.origin_sector_name} → {request.destination_sector_name}</div>
          <h1>{request.title}</h1>
          <p className="muted">
            {request.competence ? `Competência ${request.competence} · ` : ""}
            prazo {new Date(request.due_at).toLocaleString("pt-BR")}
          </p>
        </div>
        <span className={`status status-${request.status.toLowerCase()}`}>{request.status}</span>
      </div>

      {request.instructions && <div className="card instructions">{request.instructions}</div>}
      {message && <div className="alert success">{message}</div>}
      {localError && <div className="alert error">{localError}</div>}

      <div className="two-column">
        <div className="stack">
          {permissions.canEdit && schema && (
            <div className="card">
              <div className="card-header">
                <div>
                  <h2>Responder</h2>
                  <p className="muted">Os dados ficam como rascunho até você enviar.</p>
                </div>
              </div>
              <label className="field compact-field">
                <span>Identificador do item</span>
                <input value={itemKey} onChange={(e) => setItemKey(e.target.value)} />
              </label>
              <DynamicFields schema={schema} value={draft} onChange={setDraft} />
              <div className="actions">
                <button className="secondary" onClick={() => save.mutate()} disabled={save.isPending}>
                  Salvar rascunho
                </button>
                <button className="primary" onClick={() => submit.mutate()} disabled={submit.isPending}>
                  Enviar para revisão
                </button>
              </div>
            </div>
          )}

          {permissions.canEdit && (
            <div className="card">
              <h2>Importar Excel</h2>
              <p className="muted">A planilha é validada primeiro; nenhuma linha é gravada sem confirmação.</p>
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadXlsx(file);
                }}
              />
              {importPreview && (
                <div className="import-preview">
                  <p>
                    <strong>{importPreview.acceptedRows}</strong> linhas válidas ·{" "}
                    <strong>{importPreview.rejectedRows}</strong> rejeitadas
                  </p>
                  {importPreview.errors.length > 0 && (
                    <div className="error-list">
                      {importPreview.errors.slice(0, 20).map((error, index) => (
                        <div key={index}>
                          Linha {error.row} · {error.field}: {error.message}
                        </div>
                      ))}
                      {importPreview.errors.length > 20 && (
                        <div>+ {importPreview.errors.length - 20} erros</div>
                      )}
                    </div>
                  )}
                  <button className="primary" onClick={() => void confirmImport()}>
                    Confirmar linhas válidas
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <h2>Itens</h2>
              <span className="muted">{allItems.length} registros</span>
            </div>
            {allItems.length === 0 ? (
              <div className="empty-state">Ainda não há itens.</div>
            ) : (
              <div className="item-list">
                {allItems.map((item) => (
                  <article className="item-card" key={item.id}>
                    <div className="item-title">
                      <strong>{item.item_key}</strong>
                      <span className={`status status-${item.status.toLowerCase()}`}>{item.status}</span>
                    </div>
                    <pre className="data-preview">{JSON.stringify(item.data, null, 2)}</pre>
                    {item.return_comment && (
                      <div className="alert warning">
                        {item.return_comment}
                        {item.correction_due_at && (
                          <> · corrigir até {new Date(item.correction_due_at).toLocaleString("pt-BR")}</>
                        )}
                      </div>
                    )}
                    <div className="actions">
                      <label className="file-button secondary">
                        Anexar evidência
                        <input
                          hidden
                          type="file"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void uploadEvidence(file, item.id);
                          }}
                        />
                      </label>
                      {permissions.canReview && item.status === "SUBMITTED" && (
                        <>
                          <button className="primary" onClick={() => void approve(item.id)}>Aprovar</button>
                          <button className="danger" onClick={() => void returnItem(item.id)}>Devolver</button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="stack">
          <div className="card">
            <h2>Responsabilidade</h2>
            <dl className="details">
              <div><dt>Responsável</dt><dd>{request.assignee_name ?? "Aguardando atribuição"}</dd></div>
              <div><dt>Origem</dt><dd>{request.origin_sector_name}</dd></div>
              <div><dt>Destino</dt><dd>{request.destination_sector_name}</dd></div>
            </dl>
          </div>

          <div className="card">
            <h2>Evidência geral</h2>
            <label className="file-button secondary full-width">
              Adicionar arquivo
              <input
                hidden
                type="file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadEvidence(file);
                }}
              />
            </label>
          </div>

          {permissions.canClose && (
            <div className="card">
              <h2>Fechamento</h2>
              <p className="muted">Gera snapshot imutável e agenda o PDF com hash.</p>
              <button className="primary full-width" onClick={() => close.mutate()}>
                Fechar solicitação
              </button>
            </div>
          )}

          {request.status === "CLOSED" && (
            <div className="card">
              <h2>Documento de fechamento</h2>
              {closure.isLoading ? (
                <p>Consultando...</p>
              ) : closure.data ? (
                <>
                  <p>Status: <strong>{closure.data.status}</strong></p>
                  {closure.data.sha256 && <code className="hash">{closure.data.sha256}</code>}
                  {closure.data.downloadUrl && (
                    <a className="primary button-link full-width" href={closure.data.downloadUrl}>
                      Baixar PDF
                    </a>
                  )}
                  {closure.data.status !== "READY" && (
                    <button
                      className="secondary full-width"
                      onClick={() => void closure.refetch()}
                    >
                      Atualizar
                    </button>
                  )}
                  {closure.data.lastError && <div className="alert error">{closure.data.lastError}</div>}
                </>
              ) : (
                <p className="muted">PDF ainda não disponível.</p>
              )}
            </div>
          )}

          {permissions.canAudit && (
            <Link className="secondary button-link full-width" to={`/audit?requestId=${id}`}>
              Ver linha do tempo
            </Link>
          )}
        </aside>
      </div>
    </section>
  );
}
