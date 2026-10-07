import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export function ForgotPasswordPage() {
  const [subdomain, setSubdomain] = useState(localStorage.getItem("handoff_subdomain") ?? "");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const tenant = await api<{ id: string }>(
        `/v1/public/tenants/resolve?subdomain=${encodeURIComponent(subdomain)}`,
        {},
        false,
      );
      await api(
        "/v1/auth/password-reset/request",
        {
          method: "POST",
          body: JSON.stringify({ tenantId: tenant.id, email }),
        },
        false,
      );
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível solicitar recuperação.");
    }
  }

  return (
    <div className="auth-screen">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Recuperar senha</h1>
        {sent ? (
          <>
            <div className="alert success">Se a conta existir, enviaremos um link de recuperação.</div>
            <Link className="text-link" to="/login">Voltar ao login</Link>
          </>
        ) : (
          <>
            <label className="field">
              <span>Empresa</span>
              <input value={subdomain} onChange={(e) => setSubdomain(e.target.value)} required />
            </label>
            <label className="field">
              <span>E-mail</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            {error && <div className="alert error">{error}</div>}
            <button className="primary">Enviar link</button>
            <Link className="text-link" to="/login">Voltar</Link>
          </>
        )}
      </form>
    </div>
  );
}
