import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, downloadAuthenticated } from "../api";

type AuditAnchor = {
  id: string;
  anchorDate: string;
  chainSeq: number;
  chainHash: string;
  manifestSha256: string;
  createdAt: string;
  chainMatches: boolean;
};

type AuditEvent = {
  id: string;
  actor_name: string | null;
  action: string;
  entity_type: string;
  created_at: string;
  before_data: unknown;
  after_data: unknown;
};

export function AuditPage() {
  const [requestId, setRequestId] = useState("");
  const [anchorVerification, setAnchorVerification] = useState<{
    valid: boolean;
    checked: number;
  } | null>(null);
  const [anchorError, setAnchorError] = useState("");

  const anchors = useQuery({
    queryKey: ["audit-anchors"],
    queryFn: () => api<{ data: AuditAnchor[] }>("/v1/audit/anchors"),
  });

  const query = useQuery({
    queryKey: ["audit", requestId],
    queryFn: () => api<{ data: AuditEvent[] }>(`/v1/requests/${requestId}/timeline`),
    enabled: /^[0-9a-fA-F-]{36}$/.test(requestId),
  });

  async function verifyAnchors() {
    setAnchorError("");
    try {
      const result = await api<{ valid: boolean; anchors: Array<{ valid: boolean }> }>(
        "/v1/audit/anchors/verify",
      );
      setAnchorVerification({
        valid: result.valid,
        checked: result.anchors.length,
      });
    } catch (cause) {
      setAnchorVerification(null);
      setAnchorError(cause instanceof Error ? cause.message : "Falha ao verificar âncoras.");
    }
  }

  async function downloadAnchor(anchorId: string) {
    setAnchorError("");
    try {
      const result = await api<{ url: string }>(`/v1/audit/anchors/${anchorId}/download`);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setAnchorError(cause instanceof Error ? cause.message : "Falha ao baixar âncora.");
    }
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Auditoria</h1>
          <p className="muted">Linha do tempo imutável por solicitação.</p>
        </div>
        <button
          className="secondary"
          onClick={() => void downloadAuthenticated("/v1/audit/export.csv", "audit.csv")}
        >
          Exportar CSV
        </button>
      </div>

      <div className="card">
        <div className="page-header">
          <div>
            <h2>Integridade da auditoria</h2>
            <p className="muted">Cadeia diária ancorada em Object Storage com retenção WORM.</p>
          </div>
          <button className="secondary" onClick={() => void verifyAnchors()}>
            Verificar âncoras
          </button>
        </div>

        {anchorVerification && (
          <div className={`alert ${anchorVerification.valid ? "success" : "error"}`}>
            {anchorVerification.valid
              ? `${anchorVerification.checked} âncora(s) verificadas com sucesso.`
              : "Uma ou mais âncoras falharam na verificação."}
          </div>
        )}
        {anchorError && <div className="alert error">{anchorError}</div>}
        {anchors.error && <div className="alert error">{anchors.error.message}</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Seq.</th>
                <th>Hash da cadeia</th>
                <th>Banco</th>
                <th>Manifesto</th>
              </tr>
            </thead>
            <tbody>
              {anchors.data?.data.map((anchor) => (
                <tr key={anchor.id}>
                  <td>{anchor.anchorDate}</td>
                  <td>{anchor.chainSeq}</td>
                  <td><code>{anchor.chainHash.slice(0, 16)}…</code></td>
                  <td>{anchor.chainMatches ? "OK" : "Divergente"}</td>
                  <td>
                    <button
                      className="secondary"
                      onClick={() => void downloadAnchor(anchor.id)}
                    >
                      Baixar
                    </button>
                  </td>
                </tr>
              ))}
              {anchors.data?.data.length === 0 && (
                <tr><td colSpan={5} className="muted">Nenhuma âncora diária gerada ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <label className="field">
          <span>ID da solicitação</span>
          <input value={requestId} onChange={(e) => setRequestId(e.target.value)} placeholder="UUID" />
        </label>
      </div>

      {query.error && <div className="alert error">{query.error.message}</div>}
      {query.data && (
        <div className="timeline">
          {query.data.data.map((event) => (
            <article className="timeline-event card" key={event.id}>
              <div className="timeline-head">
                <strong>{event.action}</strong>
                <span>{new Date(event.created_at).toLocaleString("pt-BR")}</span>
              </div>
              <p className="muted">{event.actor_name ?? "Sistema"} · {event.entity_type}</p>
              <details>
                <summary>Dados</summary>
                <pre>{JSON.stringify({ before: event.before_data, after: event.after_data }, null, 2)}</pre>
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
