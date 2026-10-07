import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";

type Notification = {
  id: string;
  request_id: string | null;
  type: string;
  title: string;
  message: string;
  read_at: string | null;
  created_at: string;
};

export function NotificationsPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ data: Notification[] }>("/v1/notifications"),
  });

  async function markRead(id: string) {
    await api(`/v1/notifications/${id}/read`, { method: "POST" });
    await client.invalidateQueries({ queryKey: ["notifications"] });
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Notificações</h1>
          <p className="muted">Prazos, atribuições e pendências operacionais.</p>
        </div>
      </div>

      <div className="notification-list">
        {query.data?.data.length ? query.data.data.map((notification) => (
          <article
            key={notification.id}
            className={`card notification-card ${notification.read_at ? "" : "unread"}`}
          >
            <div className="notification-head">
              <div>
                <div className="eyebrow">{notification.type}</div>
                <strong>{notification.title}</strong>
              </div>
              <span className="small muted">{new Date(notification.created_at).toLocaleString("pt-BR")}</span>
            </div>
            <p>{notification.message}</p>
            <div className="action-row">
              {notification.request_id && (
                <Link className="button secondary" to={`/requests/${notification.request_id}`}>
                  Abrir solicitação
                </Link>
              )}
              {!notification.read_at && (
                <button className="link-button" onClick={() => void markRead(notification.id)}>
                  Marcar como lida
                </button>
              )}
            </div>
          </article>
        )) : (
          <div className="card empty-state">Nenhuma notificação.</div>
        )}
      </div>
    </section>
  );
}
