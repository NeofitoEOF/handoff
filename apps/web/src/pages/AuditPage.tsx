import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, downloadAuthenticated } from "../api";

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
  const query = useQuery({
    queryKey: ["audit", requestId],
    queryFn: () => api<{ data: AuditEvent[] }>(`/v1/requests/${requestId}/timeline`),
    enabled: /^[0-9a-fA-F-]{36}$/.test(requestId),
  });

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
