import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { API_URL } from "../api";
import { DynamicFields } from "../components/DynamicFields";
import type { RequestItem, TemplateSchema } from "../types";

type GuestRequest = {
  kind: "ok";
  request: {
    id: string;
    title: string;
    instructions: string | null;
    due_at: string;
    status: string;
    competence: string | null;
    origin_sector_name: string;
    destination_sector_name: string;
    schema_json: TemplateSchema | null;
  };
  items: RequestItem[];
  guestEmail: string;
};

async function guestFetch<T>(
  path: string,
  init: RequestInit = {},
  sessionToken?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (sessionToken) headers.set("authorization", `Bearer ${sessionToken}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: "omit",
  });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export function GuestPage() {
  const [params] = useSearchParams();
  const linkToken = params.get("token") ?? "";
  const storageKey = useMemo(
    () => (linkToken ? `handoff_guest_${linkToken.slice(-12)}` : "handoff_guest"),
    [linkToken],
  );
  const [sessionToken, setSessionToken] = useState(() => sessionStorage.getItem(storageKey) ?? "");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [request, setRequest] = useState<GuestRequest | null>(null);
  const [itemKey, setItemKey] = useState("item-1");
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(token = sessionToken) {
    if (!token) return;
    try {
      const data = await guestFetch<GuestRequest>("/v1/guest/request", {}, token);
      setRequest(data);
      setError("");
    } catch (cause) {
      sessionStorage.removeItem(storageKey);
      setSessionToken("");
      setRequest(null);
      setError(cause instanceof Error ? cause.message : "Sessão expirada.");
    }
  }

  useEffect(() => {
    if (sessionToken) void load(sessionToken);
  }, [sessionToken]);

  async function requestOtp() {
    setBusy(true);
    setError("");
    try {
      await guestFetch("/v1/guest/request-otp", {
        method: "POST",
        body: JSON.stringify({ linkToken }),
      });
      setOtpSent(true);
      setMessage("Código enviado ao e-mail do convite.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar o código.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    setBusy(true);
    setError("");
    try {
      const result = await guestFetch<{
        sessionToken: string;
        expiresAt: string;
        requestId: string;
      }>("/v1/guest/verify-otp", {
        method: "POST",
        body: JSON.stringify({ linkToken, otp }),
      });
      sessionStorage.setItem(storageKey, result.sessionToken);
      setSessionToken(result.sessionToken);
      setMessage("Acesso confirmado.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Código inválido.");
    } finally {
      setBusy(false);
    }
  }

  async function saveItem() {
    if (!sessionToken) return;
    setBusy(true);
    setError("");
    try {
      await guestFetch(
        `/v1/guest/items/${encodeURIComponent(itemKey)}`,
        {
          method: "PUT",
          body: JSON.stringify({ data: draft }),
        },
        sessionToken,
      );
      setMessage("Rascunho salvo.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!sessionToken) return;
    setBusy(true);
    setError("");
    try {
      await guestFetch("/v1/guest/submit", { method: "POST" }, sessionToken);
      setMessage("Resposta enviada para revisão.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar.");
    } finally {
      setBusy(false);
    }
  }

  function chooseItem(item: RequestItem) {
    setItemKey(item.item_key);
    setDraft(item.data);
  }

  if (!linkToken) {
    return (
      <div className="auth-screen">
        <div className="card auth-card">
          <h1>Link inválido</h1>
          <p>O token da solicitação não foi informado.</p>
        </div>
      </div>
    );
  }

  if (!sessionToken || !request) {
    return (
      <div className="auth-screen">
        <div className="card auth-card">
          <h1>Responder solicitação</h1>
          <p className="muted">Confirme seu acesso com o código enviado por e-mail.</p>
          {!otpSent ? (
            <button className="primary" disabled={busy} onClick={() => void requestOtp()}>
              Enviar código
            </button>
          ) : (
            <>
              <label className="field">
                <span>Código de 6 dígitos</span>
                <input
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                />
              </label>
              <button className="primary" disabled={busy || otp.length !== 6} onClick={() => void verifyOtp()}>
                Confirmar
              </button>
              <button className="link-button" disabled={busy} onClick={() => void requestOtp()}>
                Reenviar código
              </button>
            </>
          )}
          {message && <div className="alert success">{message}</div>}
          {error && <div className="alert error">{error}</div>}
        </div>
      </div>
    );
  }

  const schema = request.request.schema_json;

  return (
    <div className="guest-shell">
      <main className="guest-content">
        <div className="page-header">
          <div>
            <div className="eyebrow">Handoff · resposta externa</div>
            <h1>{request.request.title}</h1>
            <p className="muted">
              {request.request.origin_sector_name} → {request.request.destination_sector_name}
            </p>
          </div>
          <span className={`status status-${request.request.status.toLowerCase()}`}>
            {request.request.status}
          </span>
        </div>

        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}

        <div className="card">
          <dl className="detail-list">
            <div><dt>Prazo</dt><dd>{new Date(request.request.due_at).toLocaleString("pt-BR")}</dd></div>
            <div><dt>Competência</dt><dd>{request.request.competence ?? "—"}</dd></div>
            <div><dt>Instruções</dt><dd>{request.request.instructions ?? "—"}</dd></div>
            <div><dt>Convidado</dt><dd>{request.guestEmail}</dd></div>
          </dl>
        </div>

        {schema && ["OPEN", "IN_PROGRESS", "IN_CORRECTION"].includes(request.request.status) && (
          <div className="card">
            <h2>Preenchimento</h2>
            <label className="field">
              <span>Identificador do item</span>
              <input value={itemKey} onChange={(e) => setItemKey(e.target.value)} />
            </label>
            <DynamicFields schema={schema} value={draft} onChange={setDraft} />
            <div className="action-row">
              <button className="secondary" disabled={busy} onClick={() => void saveItem()}>
                Salvar rascunho
              </button>
              <button className="primary" disabled={busy} onClick={() => void submit()}>
                Enviar para revisão
              </button>
            </div>
          </div>
        )}

        <div className="card table-card">
          <h2>Itens</h2>
          {request.items.length ? (
            <table>
              <thead><tr><th>Item</th><th>Status</th><th>Observação</th></tr></thead>
              <tbody>
                {request.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <button className="text-button" onClick={() => chooseItem(item)}>
                        {item.item_key}
                      </button>
                    </td>
                    <td><span className={`status status-${item.status.toLowerCase()}`}>{item.status}</span></td>
                    <td>{item.return_comment ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">Nenhum item preenchido.</div>
          )}
        </div>
      </main>
    </div>
  );
}
