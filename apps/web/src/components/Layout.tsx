import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, Outlet } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

type SessionProfile = {
  name: string;
  email: string;
  tenantRole: "ADMIN" | "AUDITOR" | "USER";
  memberships: Array<{ sector_id: string; sector_name: string; role: "MANAGER" | "APPROVER" | "MEMBER" }>;
};

export function Layout() {
  const { logout } = useAuth();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<SessionProfile>("/v1/session"),
  });
  const unread = useQuery({
    queryKey: ["notifications", "count"],
    queryFn: () => api<{ total: number }>("/v1/notifications/unread-count"),
    refetchInterval: 60_000,
  });

  const profile = session.data;
  const roles = new Set(profile?.memberships.map((membership) => membership.role) ?? []);
  const isAdmin = profile?.tenantRole === "ADMIN";
  const isAuditor = profile?.tenantRole === "AUDITOR";
  const canOpenRequest = roles.has("MANAGER") || roles.has("APPROVER") || roles.has("MEMBER");
  const canManageSector = isAdmin || roles.has("MANAGER");
  const canEditTemplates = roles.has("MANAGER");
  const canAudit = isAdmin || isAuditor || roles.has("MANAGER");
  const unreadCount = unread.data?.total ?? 0;

  const links = [
    { to: "/inbox", label: "Caixa de entrada", visible: true },
    { to: "/requests/new", label: "Nova solicitação", visible: canOpenRequest },
    { to: "/sectors", label: "Setores", visible: canManageSector },
    { to: "/templates", label: "Modelos", visible: canEditTemplates },
    { to: "/notifications", label: "Notificações", visible: true },
    { to: "/audit", label: "Auditoria", visible: canAudit },
    { to: "/compliance", label: "Compliance/LGPD", visible: isAdmin },
    { to: "/admin", label: "Administração", visible: isAdmin },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/inbox" className="brand">Handoff</Link>
        <nav>
          {links.filter((link) => link.visible).map((link) => (
            <NavLink key={link.to} to={link.to}>
              <span>{link.label}</span>
              {link.to === "/notifications" && unreadCount > 0 && (
                <span className="nav-count">{unreadCount > 99 ? "99+" : unreadCount}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-user">
          {profile && (
            <div>
              <strong>{profile.name}</strong>
              <span>{profile.email}</span>
            </div>
          )}
          <button className="link-button" onClick={() => void logout()}>Sair</button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
