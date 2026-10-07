import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";

export function InvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api(
        "/v1/invitations/accept",
        {
          method: "POST",
          body: JSON.stringify({ token, name, password }),
        },
        false,
      );
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Convite inválido.");
    }
  }

  return (
    <div className="auth-screen">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Aceitar convite</h1>
        {done ? (
          <>
            <div className="alert success">Conta ativada e acesso ao setor concedido.</div>
            <Link className="text-link" to="/login">Entrar</Link>
          </>
        ) : (
          <>
            <label className="field">
              <span>Nome</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="field">
              <span>Senha</span>
              <input
                type="password"
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error && <div className="alert error">{error}</div>}
            <button className="primary" disabled={!token}>Criar acesso</button>
          </>
        )}
      </form>
    </div>
  );
}
