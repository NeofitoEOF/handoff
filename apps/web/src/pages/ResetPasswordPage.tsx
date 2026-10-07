import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api(
        "/v1/auth/password-reset/confirm",
        {
          method: "POST",
          body: JSON.stringify({ token, newPassword: password }),
        },
        false,
      );
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível alterar a senha.");
    }
  }

  return (
    <div className="auth-screen">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Nova senha</h1>
        {done ? (
          <>
            <div className="alert success">Senha alterada. Suas sessões anteriores foram revogadas.</div>
            <Link className="text-link" to="/login">Entrar</Link>
          </>
        ) : (
          <>
            <label className="field">
              <span>Nova senha</span>
              <input
                type="password"
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error && <div className="alert error">{error}</div>}
            <button className="primary" disabled={!token}>Alterar senha</button>
          </>
        )}
      </form>
    </div>
  );
}
