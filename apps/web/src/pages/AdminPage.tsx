import { useState } from "react";
import { api, downloadAuthenticated } from "../api";

export function AdminPage() {
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [otp, setOtp] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
