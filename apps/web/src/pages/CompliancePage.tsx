import { useEffect, useState } from "react";
import { api, downloadAuthenticated } from "../api";

type ComplianceSettings = {
  retention_years: number;
  default_legal_basis: string | null;
  dpa_status: "NOT_CONFIGURED" | "DRAFT" | "SIGNED";
  dpa_reference: string | null;
  dpa_signed_at: string | null;
};

type ProcessingActivity = {
  id: string;
  name: string;
  purpose: string;
  legal_basis: string;
  data_categories: string[];
  subject_categories: string[];
  processors: string[];
  retention_years: number | null;
  active: boolean;
};

type DataSubjectRequest = {
  id: string;
  subject_user_id: string;
  subject_name: string;
  subject_email: string;
  request_type: "ACCESS" | "CORRECTION" | "ERASURE" | "RESTRICTION";
  status: "OPEN" | "IN_REVIEW" | "COMPLETED" | "REJECTED";
  reason: string | null;
  resolution: string | null;
  created_at: string;
  completed_at: string | null;
};

type RetentionCandidate = {
  id: string;
  title: string;
  status: string;
  competence: string | null;
  updated_at: string;
};

export function CompliancePage() {
  const [settings, setSettings] = useState<ComplianceSettings | null>(null);
  const [activities, setActivities] = useState<ProcessingActivity[]>([]);
  const [requests, setRequests] = useState<DataSubjectRequest[]>([]);
  const [candidates, setCandidates] = useState<RetentionCandidate[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [activityName, setActivityName] = useState("");
  const [activityPurpose, setActivityPurpose] = useState("");
  const [activityLegalBasis, setActivityLegalBasis] = useState("");
  const [activityDataCategories, setActivityDataCategories] = useState("");
  const [activitySubjectCategories, setActivitySubjectCategories] = useState("");
  const [activityProcessors, setActivityProcessors] = useState("");

  const [subjectUserId, setSubjectUserId] = useState("");
  const [subjectRequestType, setSubjectRequestType] =
    useState<DataSubjectRequest["request_type"]>("ACCESS");
  const [subjectReason, setSubjectReason] = useState("");
  const [resolutions, setResolutions] = useState<Record<string, string>>({});

  async function loadAll() {
    setError("");
    try {
      const [settingsResult, activityResult, requestResult, retentionResult] = await Promise.all([
        api<ComplianceSettings>("/v1/admin/compliance"),
        api<{ data: ProcessingActivity[] }>("/v1/admin/compliance/processing-activities"),
        api<{ data: DataSubjectRequest[] }>("/v1/admin/data-subject-requests"),
        api<{ data: RetentionCandidate[] }>("/v1/admin/compliance/retention-candidates?limit=100"),
      ]);
      setSettings(settingsResult);
      setActivities(activityResult.data);
      setRequests(requestResult.data);
      setCandidates(retentionResult.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar compliance.");
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function saveSettings() {
    if (!settings) return;
    setError("");
    setMessage("");
    try {
      const updated = await api<ComplianceSettings>("/v1/admin/compliance", {
        method: "PATCH",
        body: JSON.stringify({
          retentionYears: settings.retention_years,
          defaultLegalBasis: settings.default_legal_basis ?? undefined,
          dpaStatus: settings.dpa_status,
          dpaReference: settings.dpa_reference ?? undefined,
          dpaSignedAt: settings.dpa_signed_at ?? undefined,
        }),
      });
      setSettings(updated);
      setMessage("Configuração de compliance atualizada.");
      await loadAll();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar compliance.");
    }
  }

  async function createActivity() {
    setError("");
    setMessage("");
    try {
      await api("/v1/admin/compliance/processing-activities", {
        method: "POST",
        body: JSON.stringify({
          name: activityName,
          purpose: activityPurpose,
          legalBasis: activityLegalBasis,
          dataCategories: splitCsv(activityDataCategories),
          subjectCategories: splitCsv(activitySubjectCategories),
          processors: splitCsv(activityProcessors),
        }),
      });
      setActivityName("");
      setActivityPurpose("");
      setActivityLegalBasis("");
      setActivityDataCategories("");
      setActivitySubjectCategories("");
      setActivityProcessors("");
      setMessage("Operação de tratamento registrada.");
      await loadAll();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao registrar tratamento.");
    }
  }

  async function createSubjectRequest() {
    setError("");
    setMessage("");
    try {
      await api("/v1/admin/data-subject-requests", {
        method: "POST",
        body: JSON.stringify({
          subjectUserId,
          requestType: subjectRequestType,
          reason: subjectReason || undefined,
        }),
      });
      setSubjectUserId("");
      setSubjectReason("");
      setMessage("Pedido de titular registrado.");
      await loadAll();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao registrar pedido.");
    }
  }

  async function updateSubjectRequest(
    id: string,
    status: DataSubjectRequest["status"],
  ) {
    setError("");
    setMessage("");
    try {
      await api(`/v1/admin/data-subject-requests/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          resolution: resolutions[id] || undefined,
        }),
      });
      setMessage("Pedido de titular atualizado.");
      await loadAll();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao atualizar pedido.");
    }
  }

  if (!settings) {
    return <section><p>Carregando compliance...</p>{error && <div className="alert error">{error}</div>}</section>;
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Compliance e LGPD</h1>
          <p className="muted">Retenção, DPA, operações de tratamento e pedidos de titular.</p>
        </div>
      </div>

      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="card stack">
        <h2>Retenção e DPA</h2>
        <label className="field">
          <span>Retenção padrão (anos)</span>
          <input
            type="number"
            min={1}
            max={20}
            value={settings.retention_years}
            onChange={(event) =>
              setSettings({ ...settings, retention_years: Number(event.target.value) })
            }
          />
        </label>
        <label className="field">
          <span>Base legal padrão</span>
          <textarea
            value={settings.default_legal_basis ?? ""}
            onChange={(event) =>
              setSettings({ ...settings, default_legal_basis: event.target.value })
            }
          />
        </label>
        <label className="field">
          <span>Status do DPA</span>
          <select
            value={settings.dpa_status}
            onChange={(event) =>
              setSettings({
                ...settings,
                dpa_status: event.target.value as ComplianceSettings["dpa_status"],
              })
            }
          >
            <option value="NOT_CONFIGURED">Não configurado</option>
            <option value="DRAFT">Em elaboração</option>
            <option value="SIGNED">Assinado</option>
          </select>
        </label>
        <label className="field">
          <span>Referência do DPA</span>
          <input
            value={settings.dpa_reference ?? ""}
            onChange={(event) =>
              setSettings({ ...settings, dpa_reference: event.target.value })
            }
          />
        </label>
        {settings.dpa_status === "SIGNED" && (
          <label className="field">
            <span>Data de assinatura</span>
            <input
              type="datetime-local"
              value={toLocalDateTime(settings.dpa_signed_at)}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  dpa_signed_at: event.target.value
                    ? new Date(event.target.value).toISOString()
                    : null,
                })
              }
            />
          </label>
        )}
        <button className="primary" onClick={() => void saveSettings()}>
          Salvar compliance
        </button>
      </div>

      <div className="card stack">
        <h2>Operações de tratamento</h2>
        <label className="field">
          <span>Nome</span>
          <input value={activityName} onChange={(e) => setActivityName(e.target.value)} />
        </label>
        <label className="field">
          <span>Finalidade</span>
          <textarea value={activityPurpose} onChange={(e) => setActivityPurpose(e.target.value)} />
        </label>
        <label className="field">
          <span>Base legal</span>
          <textarea value={activityLegalBasis} onChange={(e) => setActivityLegalBasis(e.target.value)} />
        </label>
        <label className="field">
          <span>Categorias de dados (separadas por vírgula)</span>
          <input value={activityDataCategories} onChange={(e) => setActivityDataCategories(e.target.value)} />
        </label>
        <label className="field">
          <span>Categorias de titulares</span>
          <input value={activitySubjectCategories} onChange={(e) => setActivitySubjectCategories(e.target.value)} />
        </label>
        <label className="field">
          <span>Operadores/processadores</span>
          <input value={activityProcessors} onChange={(e) => setActivityProcessors(e.target.value)} />
        </label>
        <button
          className="secondary"
          disabled={!activityName || !activityPurpose || !activityLegalBasis}
          onClick={() => void createActivity()}
        >
          Registrar operação
        </button>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Operação</th>
                <th>Base legal</th>
                <th>Dados</th>
                <th>Operadores</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((activity) => (
                <tr key={activity.id}>
                  <td>{activity.name}</td>
                  <td>{activity.legal_basis}</td>
                  <td>{activity.data_categories.join(", ") || "—"}</td>
                  <td>{activity.processors.join(", ") || "—"}</td>
                  <td>{activity.active ? "Ativo" : "Inativo"}</td>
                </tr>
              ))}
              {activities.length === 0 && (
                <tr><td colSpan={5} className="muted">Nenhuma operação registrada.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card stack">
        <h2>Pedidos de titular</h2>
        <label className="field">
          <span>ID do usuário titular</span>
          <input value={subjectUserId} onChange={(e) => setSubjectUserId(e.target.value)} />
        </label>
        <label className="field">
          <span>Tipo</span>
          <select
            value={subjectRequestType}
            onChange={(event) =>
              setSubjectRequestType(event.target.value as DataSubjectRequest["request_type"])
            }
          >
            <option value="ACCESS">Acesso</option>
            <option value="CORRECTION">Correção</option>
            <option value="ERASURE">Eliminação</option>
            <option value="RESTRICTION">Restrição</option>
          </select>
        </label>
        <label className="field">
          <span>Motivo/observação</span>
          <textarea value={subjectReason} onChange={(e) => setSubjectReason(e.target.value)} />
        </label>
        <button
          className="secondary"
          disabled={!subjectUserId}
          onClick={() => void createSubjectRequest()}
        >
          Registrar pedido
        </button>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Titular</th>
                <th>Tipo</th>
                <th>Status</th>
                <th>Resolução</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.subject_name}<br />
                    <span className="muted">{item.subject_email}</span>
                  </td>
                  <td>{item.request_type}</td>
                  <td>{item.status}</td>
                  <td>
                    <input
                      value={resolutions[item.id] ?? item.resolution ?? ""}
                      disabled={item.status === "COMPLETED" || item.status === "REJECTED"}
                      onChange={(event) =>
                        setResolutions({ ...resolutions, [item.id]: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <div className="button-row">
                      <button
                        className="secondary"
                        disabled={item.status === "COMPLETED" || item.status === "REJECTED"}
                        onClick={() => void updateSubjectRequest(item.id, "IN_REVIEW")}
                      >
                        Em análise
                      </button>
                      <button
                        className="secondary"
                        disabled={item.status === "COMPLETED" || item.status === "REJECTED"}
                        onClick={() => void updateSubjectRequest(item.id, "COMPLETED")}
                      >
                        Concluir
                      </button>
                      <button
                        className="secondary"
                        onClick={() =>
                          void downloadAuthenticated(
                            `/v1/admin/data-subjects/${item.subject_user_id}/export`,
                            `data-subject-${item.subject_user_id}.json`,
                          )
                        }
                      >
                        Exportar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {requests.length === 0 && (
                <tr><td colSpan={5} className="muted">Nenhum pedido registrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Elegíveis para revisão de retenção</h2>
        <p className="muted">
          O sistema não exclui automaticamente. Esta lista indica registros além da janela configurada.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Solicitação</th>
                <th>Status</th>
                <th>Competência</th>
                <th>Última atualização</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((item) => (
                <tr key={item.id}>
                  <td>{item.title}</td>
                  <td>{item.status}</td>
                  <td>{item.competence ?? "—"}</td>
                  <td>{new Date(item.updated_at).toLocaleString("pt-BR")}</td>
                </tr>
              ))}
              {candidates.length === 0 && (
                <tr><td colSpan={4} className="muted">Nenhum registro elegível.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toLocalDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
