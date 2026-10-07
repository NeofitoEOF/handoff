import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";

type Member = {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: "MANAGER" | "APPROVER" | "MEMBER";
  active: boolean;
};

type Metric = {
  total: number;
  open: number;
  overdue: number;
  in_review: number;
  in_correction: number;
  closed: number;
};

export function SectorDetailPage() {
  const { id = "" } = useParams();
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"MANAGER" | "APPROVER" | "MEMBER">("MEMBER");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const members = useQuery({
    queryKey: ["sector-members", id],
    queryFn: () => api<{ data: Member[] }>(`/v1/sectors/${id}/members`),
    enabled: !!id,
  });

  const metrics = useQuery({
    queryKey: ["sector-metrics", id],
    queryFn: () => api<Metric>(`/v1/sectors/${id}/metrics`),
    enabled: !!id,
  });

  async function invite(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api(`/v1/sectors/${id}/invitations`, {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setMessage("Convite enviado.");
      setEmail("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao convidar.");
    }
  }

  async function deactivateMember(userId: string) {
    setError("");
    try {
      const result = await api<{ waitingReassignmentCount: number }>(
        `/v1/sectors/${id}/members/${userId}`,
        { method: "DELETE" },
      );
      setMessage(
        result.waitingReassignmentCount
          ? `Membro removido. ${result.waitingReassignmentCount} solicitação(ões) aguardam reatribuição.`
          : "Membro removido.",
      );
      await client.invalidateQueries({ queryKey: ["sector-members", id] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao remover membro.");
    }
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <Link className="text-link" to="/sectors">← Setores</Link>
          <h1>Gestão do setor</h1>
          <p className="muted">Membros, papéis, convites e indicadores.</p>
        </div>
      </div>

      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      {metrics.data && (
        <div className="metric-grid">
          {[
            ["Abertas", metrics.data.open],
            ["Atrasadas", metrics.data.overdue],
            ["Em revisão", metrics.data.in_review],
            ["Em correção", metrics.data.in_correction],
            ["Fechadas", metrics.data.closed],
          ].map(([label, value]) => (
            <div className="metric-card" key={String(label)}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      )}

      <form className="card inline-form invite-form" onSubmit={invite}>
        <label className="field">
          <span>E-mail para convite</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Papel</span>
          <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="MEMBER">Membro</option>
            <option value="APPROVER">Aprovador</option>
            <option value="MANAGER">Gestor</option>
          </select>
        </label>
        <button className="primary">Convidar</button>
      </form>

      <div className="card table-card">
        <table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>
            {members.data?.data.map((member) => (
              <tr key={member.id}>
                <td>{member.name}</td>
                <td>{member.email}</td>
                <td>{member.role}</td>
                <td>{member.active ? "Ativo" : "Inativo"}</td>
                <td>
                  {member.active && (
                    <button className="danger" onClick={() => void deactivateMember(member.user_id)}>
                      Remover
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
