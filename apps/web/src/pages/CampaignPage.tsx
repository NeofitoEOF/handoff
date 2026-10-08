import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { dueLabel, statusLabel } from "../format";

type CampaignView = {
  campaign: {
    id: string;
    title: string;
    competence: string | null;
    due_at: string;
    instructions: string | null;
  };
  requests: Array<{
    id: string;
    title: string;
    status: string;
    due_at: string;
    destination_sector_name: string;
    assigned_to: string | null;
  }>;
};

export function CampaignPage() {
  const { id = "" } = useParams();
  const query = useQuery({
    queryKey: ["campaign", id],
    queryFn: () => api<CampaignView>(`/v1/campaigns/${id}`),
    enabled: !!id,
  });

  if (query.isLoading) return <p>Carregando...</p>;
  if (query.error) return <div className="alert error">{query.error.message}</div>;
  if (!query.data) return null;

  const { campaign, requests } = query.data;

  return (
    <section>
      <div className="page-header">
        <div>
          <Link className="text-link" to="/inbox">← Caixa de entrada</Link>
          <h1>{campaign.title}</h1>
          <p className="muted">
            Coleta com uma solicitação independente por setor.
            {campaign.competence ? ` Competência ${campaign.competence}.` : ""}
          </p>
        </div>
      </div>

      {campaign.instructions && <div className="card"><p>{campaign.instructions}</p></div>}

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Setor</th>
              <th>Status</th>
              <th>Prazo</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td><Link to={`/requests/${request.id}`}>{request.destination_sector_name}</Link></td>
                <td><span className={`status status-${request.status.toLowerCase()}`}>{statusLabel(request.status)}</span></td>
                <td>{dueLabel(request.due_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
