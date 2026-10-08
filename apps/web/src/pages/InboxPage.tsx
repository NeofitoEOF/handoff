import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { dueLabel, statusLabel } from "../format";

type InboxRow = {
  id: string;
  title: string;
  status: string;
  due_at: string;
  competence: string | null;
  origin_sector_name: string;
  destination_sector_name: string;
  overdue: boolean;
};

const views = [
  ["assigned", "Para mim"],
  ["sector", "Meu setor"],
  ["to_review", "Para revisar"],
  ["overdue", "Atrasados"],
] as const;

export function InboxPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") ?? "assigned";

  const query = useQuery({
    queryKey: ["inbox", view],
    queryFn: () => api<{ data: InboxRow[] }>(`/v1/inbox?view=${view}`),
  });

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Caixa de entrada</h1>
          <p className="muted">Pedidos, revisões e atrasos em um único lugar.</p>
        </div>
      </div>

      <div className="tabs">
        {views.map(([key, label]) => (
          <button
            key={key}
            className={view === key ? "active" : ""}
            onClick={() => setParams({ view: key })}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="card table-card">
        {query.isLoading ? (
          <p>Carregando...</p>
        ) : query.error ? (
          <div className="alert error">{query.error.message}</div>
        ) : query.data?.data.length === 0 ? (
          <div className="empty-state">Nenhuma solicitação nesta visão.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Solicitação</th>
                <th>Origem → destino</th>
                <th>Competência</th>
                <th>Status</th>
                <th>Prazo</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.data.map((row) => (
                <tr key={row.id} className={row.overdue ? "overdue-row" : ""}>
                  <td><Link to={`/requests/${row.id}`}>{row.title}</Link></td>
                  <td>{row.origin_sector_name} → {row.destination_sector_name}</td>
                  <td>{row.competence ?? "—"}</td>
                  <td><span className={`status status-${row.status.toLowerCase()}`}>{statusLabel(row.status)}</span></td>
                  <td className={row.overdue ? "due-late" : ""}>{dueLabel(row.due_at, row.overdue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
