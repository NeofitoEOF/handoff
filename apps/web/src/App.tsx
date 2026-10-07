import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AdminPage } from "./pages/AdminPage";
import { AuditPage } from "./pages/AuditPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { GuestPage } from "./pages/GuestPage";
import { InboxPage } from "./pages/InboxPage";
import { InvitePage } from "./pages/InvitePage";
import { LoginPage } from "./pages/LoginPage";
import { MicrosoftCallbackPage } from "./pages/MicrosoftCallbackPage";
import { NewRequestPage } from "./pages/NewRequestPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { RequestPage } from "./pages/RequestPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { SectorsPage } from "./pages/SectorsPage";
import { SectorDetailPage } from "./pages/SectorDetailPage";
import { TemplateDetailPage } from "./pages/TemplateDetailPage";
import { TemplatesPage } from "./pages/TemplatesPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/microsoft/callback" element={<MicrosoftCallbackPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/invite" element={<InvitePage />} />
      <Route path="/guest" element={<GuestPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/requests/new" element={<NewRequestPage />} />
          <Route path="/requests/:id" element={<RequestPage />} />
          <Route path="/sectors" element={<SectorsPage />} />
          <Route path="/sectors/:id" element={<SectorDetailPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/templates/:id" element={<TemplateDetailPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/inbox" replace />} />
      <Route path="*" element={<Navigate to="/inbox" replace />} />
    </Routes>
  );
}
