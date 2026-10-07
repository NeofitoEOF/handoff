import { useState, type FormEvent } from "react";
import { Navigate, Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";

function inferredSubdomain(): string {
  const host = window.location.hostname;
  if (host !== "localhost" && host.includes(".")) return host.split(".")[0] ?? "";
  return localStorage.getItem("handoff_subdomain") ?? "";
}

export function LoginPage() {
  const { authenticated, login } = useAuth();
  const navigate = useNavigate();
  const [subdomain, setSubdomain] = useState(inferredSubdomain);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (authenticated) return <Navigate to="/inbox" replace />;

  async function microsoftLogin() {
    setError("");
    if (!subdomain) {
      setError("Informe a empresa antes de entrar com Microsoft.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ authorizeUrl: string }>(
        `/v1/auth/microsoft/start?subdomain=${encodeURIComponent(subdomain)}`,
        {},
        false,
      );
      localStorage.setItem("handoff_subdomain", subdomain);
      window.location.assign(result.authorizeUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Login Microsoft indisponível.");
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login({
        subdomain,
        email,
        password,
        ...(mfaRequired && otp ? { otp } : {}),
      });
      localStorage.setItem("handoff_subdomain", subdomain);
      navigate("/inbox", { replace: true });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 428) {
        setMfaRequired(true);
        setError("Informe o código do autenticador.");
      } else {
        setError(cause instanceof Error ? cause.message : "Falha no login.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="card auth-card" onSubmit={submit}>
        <div>
          <h1>Handoff</h1>
          <p className="muted">Solicitações entre áreas com evidência e aprovação.</p>
        </div>

        <label className="field">
          <span>Empresa</span>
          <input
            value={subdomain}
            onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
            placeholder="minha-empresa"
            required
          />
        </label>
        <label className="field">
          <span>E-mail</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Senha</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {mfaRequired && (
          <label className="field">
            <span>Código MFA</span>
            <input
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              autoFocus
              required
            />
          </label>
        )}
        {error && <div className="alert error">{error}</div>}
        <button className="primary" disabled={busy}>
          {busy ? "Entrando..." : "Entrar"}
        </button>
        <div className="auth-divider"><span>ou</span></div>
        <button type="button" className="secondary" disabled={busy} onClick={() => void microsoftLogin()}>
          Entrar com Microsoft
        </button>
        <Link className="text-link" to="/forgot-password">Esqueci minha senha</Link>
      </form>
    </div>
  );
}
