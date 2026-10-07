import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

type DeadLetterKind = "email" | "teams" | "webhook" | "closure";

type DeadLetterItem = {
  kind: DeadLetterKind;
  id: string;
  requestId: string | null;
  attempts: number;
  lastError: string | null;
  availableAt: string;
  createdAt: string;
  context: Record<string, unknown>;
};

const kindLabel: Record<DeadLetterKind, string> = {
  email: "E-mail",
  teams: "Teams",
  webhook: "Webhook",
  closure: "PDF de fechamento",
};

export function DeadLetterPanel() {
  const [items, setItems] = useState<DeadLetterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ data: DeadLetterItem[] }>("/v1/admin/dead-letters?limit=100");
      setItems(result.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar falhas operacionais.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function retry(item: DeadLetterItem) {
    const reason = (reasons[item.id] ?? "").trim();
    if (reason.length < 3) {
      setError("Informe o motivo do reprocessamento.");
      return;
    }

    setRetryingId(item.id);
    setError("");
    setMessage("");

    try {
      await api(`/v1/admin/dead-letters/${item.kind}/${item.id}/retry`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setMessage(`${kindLabel[item.kind]} reenfileirado com sucesso.`);
      setReasons((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao reprocessar item.");
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <div className="card">
      <div className="page-header">
        <div>
          <h2>Falhas operacionais</h2>
          <p className="muted">
            Itens que esgotaram as tentativas automáticas. O reprocessamento exige justificativa e fica auditado.
          </p>
        </div>
        <button className="secondary" onClick={() => void load()} disabled={loading}>
          Atualizar
        </button>
      </div>

      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <p className="muted">Carregando falhas...</p>
      ) : items.length === 0 ? (
        <p className="muted">Nenhum item esgotado no momento.</p>
      ) : (
        <div className="stack">
          {items.map((item) => (
            <div className="card" key={`${item.kind}:${item.id}`}>
              <div className="page-header">
                <div>
                  <strong>{kindLabel[item.kind]}</strong>
                  <div className="muted">
                    {item.attempts} tentativas · {new Date(item.createdAt).toLocaleString("pt-BR")}
                  </div>
                </div>
                <code className="mono">{item.id.slice(0, 8)}</code>
              </div>

              {item.lastError && (
                <div className="alert error">
                  {item.lastError}
                </div>
              )}

              <details>
                <summary>Contexto</summary>
                <pre className="mono block">{JSON.stringify(item.context, null, 2)}</pre>
              </details>

              <label className="field">
                <span>Motivo do reprocessamento</span>
                <input
                  value={reasons[item.id] ?? ""}
                  onChange={(event) =>
                    setReasons((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }))
                  }
                  placeholder="Ex.: SMTP normalizado após indisponibilidade do provedor"
                />
              </label>

              <button
                className="secondary"
                disabled={retryingId === item.id}
                onClick={() => void retry(item)}
              >
                {retryingId === item.id ? "Reenfileirando..." : "Reprocessar"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
