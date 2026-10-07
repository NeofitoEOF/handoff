import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";

export function Layout() {
  const { logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/inbox" className="brand">Handoff</Link>
        <nav>
          <NavLink to="/inbox">Caixa de entrada</NavLink>
          <NavLink to="/requests/new">Nova solicitação</NavLink>
          <NavLink to="/sectors">Setores</NavLink>
          <NavLink to="/templates">Modelos</NavLink>
          <NavLink to="/notifications">Notificações</NavLink>
          <NavLink to="/audit">Auditoria</NavLink>
          <NavLink to="/compliance">Compliance/LGPD</NavLink>
          <NavLink to="/admin">Administração</NavLink>
        </nav>
        <button className="link-button" onClick={() => void logout()}>Sair</button>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
