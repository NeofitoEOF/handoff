import { useEffect, useState } from "react";
import { api, downloadAuthenticated } from "../api";

export function AdminPage() {
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [otp, setOtp] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [entraTenantId, setEntraTenantId] = useState("");
  const [microsoftEnabled, setMicrosoftEnabled] = useState(true);
  const [teamsWebhookUrl, setTeamsWebhookUrl] = useState("");
  const [hasTeamsWebhook, setHasTeamsWebhook] = useState(false);
  const [billingSummary, setBillingSummary] = useState<{
    profile: {
      plan: string;
      status: string;
      monthly_price_per_sector_cents: number;
      currency: string;
    };
    entitlements: { maxSectors: number | null; storageBytes: number | null };
    usage: { enabledSectors: number; requestsThisMonth: number; storageBytes: number };
    estimatedMonthlyAmountCents: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    void api<{
      profile: {
        plan: string;
        status: string;
        monthly_price_per_sector_cents: number;
        currency: string;
      };
      entitlements: { maxSectors: number | null; storageBytes: number | null };
      usage: { enabledSectors: number; requestsThisMonth: number; storageBytes: number };
      estimatedMonthlyAmountCents: number;
    }>("/v1/admin/billing")
      .then((summary) => {
        if (!cancelled) setBillingSummary(summary);
      })
      .catch(() => undefined);

    void (async () => {
      try {
        const integration = await api<{
          entra_tenant_id: string;
          enabled: boolean;
          has_teams_webhook: boolean;
        } | null>("/v1/admin/integrations/microsoft");

        if (!cancelled && integration) {
          setEntraTenantId(integration.entra_tenant_id);
          setMicrosoftEnabled(integration.enabled);
          setHasTeamsWebhook(integration.has_teams_webhook);
        }
      } catch {
        // Tela continua utilizável mesmo antes da integração existir.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveTeamsWebhook(remove = false) {
    setError("");
    try {
      const result = await api<{ configured: boolean }>(
        "/v1/admin/integrations/microsoft/teams",
        {
          method: "PUT",
          body: JSON.stringify({
            webhookUrl: remove ? null : teamsWebhookUrl,
          }),
        },
      );
      setHasTeamsWebhook(result.configured);
      setTeamsWebhookUrl("");
      setMessage(
        result.configured
          ? "Webhook do Microsoft Teams configurado."
          : "Webhook do Microsoft Teams removido.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao configurar Teams.");
    }
  }

  async function saveMicrosoft() {
    setError("");
    try {
      await api("/v1/admin/integrations/microsoft", {
        method: "PUT",
        body: JSON.stringify({
          entraTenantId,
          enabled: microsoftEnabled,
        }),
      });
      setMessage("Integração Microsoft atualizada.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao configurar Microsoft.");
    }
  }

  async function setupMfa() {
    setError("");
    try {
      const result = await api<{ secret: string; otpauthUri: string }>("/v1/auth/mfa/setup", {
        method: "POST",
      });
      setSetup(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao configurar MFA.");
    }
  }

  async function enableMfa() {
    setError("");
    try {
      await api("/v1/auth/mfa/confirm", {
        method: "POST",
        body: JSON.stringify({ otp }),
      });
      setMessage("MFA habilitado.");
      setSetup(null);
      setOtp("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao confirmar MFA.");
    }
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Administração</h1>
          <p className="muted">Segurança e portabilidade dos dados.</p>
        </div>
      </div>

      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="card">
        <h2>MFA</h2>
        {!setup ? (
          <button className="secondary" onClick={() => void setupMfa()}>
            Configurar autenticador
          </button>
        ) : (
          <div className="stack">
            <p>Adicione o segredo no seu aplicativo autenticador:</p>
            <code className="mono block">{setup.secret}</code>
            <details>
              <summary>URI otpauth</summary>
              <code className="mono block">{setup.otpauthUri}</code>
            </details>
            <label className="field">
              <span>Código de 6 dígitos</span>
              <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
            </label>
            <button className="primary" onClick={() => void enableMfa()}>Confirmar MFA</button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Microsoft Entra ID</h2>
        <p className="muted">Habilite login Microsoft para usuários já cadastrados na empresa.</p>
        <label className="field">
          <span>Tenant ID do Entra</span>
          <input
            value={entraTenantId}
            onChange={(event) => setEntraTenantId(event.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
          />
        </label>
        <label className="checkbox-field field">
          <input
            type="checkbox"
            checked={microsoftEnabled}
            onChange={(event) => setMicrosoftEnabled(event.target.checked)}
          />
          <span>Login Microsoft habilitado</span>
        </label>
        <button className="secondary" onClick={() => void saveMicrosoft()} disabled={!entraTenantId}>
          Salvar Microsoft
        </button>
      </div>

      {billingSummary && (
        <div className="card">
          <h2>Plano e uso</h2>
          <div className="metric-grid">
            <div className="metric-card">
              <span>Plano</span>
              <strong>{billingSummary.profile.plan}</strong>
            </div>
            <div className="metric-card">
              <span>Status</span>
              <strong>{billingSummary.profile.status}</strong>
            </div>
            <div className="metric-card">
              <span>Setores</span>
              <strong>
                {billingSummary.usage.enabledSectors}
                {billingSummary.entitlements.maxSectors !== null
                  ? `/${billingSummary.entitlements.maxSectors}`
                  : ""}
              </strong>
            </div>
            <div className="metric-card">
              <span>Solicitações no mês</span>
              <strong>{billingSummary.usage.requestsThisMonth}</strong>
            </div>
            <div className="metric-card">
              <span>Estimativa mensal</span>
              <strong>
                {new Intl.NumberFormat("pt-BR", {
                  style: "currency",
                  currency: billingSummary.profile.currency,
                }).format(billingSummary.estimatedMonthlyAmountCents / 100)}
              </strong>
            </div>
          </div>
          <p className="muted">
            Armazenamento usado: {(billingSummary.usage.storageBytes / 1024 / 1024).toFixed(1)} MB
            {billingSummary.entitlements.storageBytes !== null
              ? ` de ${(billingSummary.entitlements.storageBytes / 1024 / 1024 / 1024).toFixed(0)} GB`
              : ""}
          </p>
        </div>
      )}

      <div className="card">
        <h2>Exportação da empresa</h2>
        <p className="muted">Exporta dados operacionais, auditoria e metadados em JSON.</p>
        <button
          className="secondary"
          onClick={() => void downloadAuthenticated("/v1/admin/tenant/export", "handoff-tenant-export.json")}
        >
          Exportar dados
        </button>
      </div>
    </section>
  );
}
