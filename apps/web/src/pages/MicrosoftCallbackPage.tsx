import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, setAccessToken } from "../api";

export function MicrosoftCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState(params.get("error") ?? "");

  useEffect(() => {
    const ticket = params.get("ticket");
    if (!ticket || error) return;

    let cancelled = false;
    void (async () => {
      try {
        const result = await api<{ accessToken: string }>(
          "/v1/auth/microsoft/exchange",
          {
            method: "POST",
            body: JSON.stringify({ ticket }),
          },
          false,
        );
        if (cancelled) return;
        setAccessToken(result.accessToken);
        navigate("/inbox", { replace: true });
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Falha ao concluir login Microsoft.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params, navigate, error]);

  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <h1>Login Microsoft</h1>
        {error ? (
          <>
            <div className="alert error">{error}</div>
            <Link className="text-link" to="/login">Voltar ao login</Link>
          </>
        ) : (
          <p>Validando sua conta Microsoft...</p>
        )}
      </div>
    </div>
  );
}
