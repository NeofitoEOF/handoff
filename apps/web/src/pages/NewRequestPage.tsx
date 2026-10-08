import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";

type Sector = { id: string; name: string; active: boolean };
type Template = {
  id: string;
  name: string;
  description: string | null;
  published_version_id: string | null;
  published_version: number | null;
};

export function NewRequestPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"single" | "campaign" | "recurrence">("single");
  const [frequency, setFrequency] = useState<"WEEKLY" | "MONTHLY">("MONTHLY");
  const [dueOffsetDays, setDueOffsetDays] = useState(5);
  const [originSectorId, setOriginSectorId] = useState("");
  const [destinationSectorIds, setDestinationSectorIds] = useState<string[]>([]);
  const [templateVersionId, setTemplateVersionId] = useState("");
  const [title, setTitle] = useState("");
  const [competence, setCompetence] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<{ memberships: Array<{ sector_id: string; role: string }> }>("/v1/session"),
  });
  const canSchedule = (session.data?.memberships ?? []).some(
    (membership) => membership.sector_id === originSectorId && membership.role === "MANAGER",
  );

  const sectors = useQuery({
    queryKey: ["sectors"],
    queryFn: () => api<{ data: Sector[] }>("/v1/sectors"),
  });

  const templates = useQuery({
    queryKey: ["templates", originSectorId],
    queryFn: () => api<{ data: Template[] }>(`/v1/sectors/${originSectorId}/templates`),
    enabled: !!originSectorId,
  });

  const availableDestinations = useMemo(
    () => (sectors.data?.data ?? []).filter((s) => s.active && s.id !== originSectorId),
    [originSectorId, sectors.data],
  );

  useEffect(() => {
    setDestinationSectorIds((current) =>
      current.filter((id) => availableDestinations.some((s) => s.id === id)),
    );
    setTemplateVersionId("");
  }, [originSectorId]);

  function toggleDestination(id: string) {
    setDestinationSectorIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (!originSectorId || destinationSectorIds.length === 0) {
      setError("Selecione origem e pelo menos um destino.");
      return;
    }

    setBusy(true);
    try {
      const common = {
        originSectorId,
        title,
        dueAt: new Date(dueAt).toISOString(),
        ...(competence ? { competence } : {}),
        ...(instructions ? { instructions } : {}),
        ...(templateVersionId ? { templateVersionId } : {}),
      };

      if (mode === "recurrence") {
        await api("/v1/recurrences", {
          method: "POST",
          body: JSON.stringify({
            originSectorId,
            destinationSectorIds,
            title,
            frequency,
            nextRunAt: new Date(dueAt).toISOString(),
            dueOffsetDays,
            ...(instructions ? { instructions } : {}),
            ...(templateVersionId ? { templateVersionId } : {}),
          }),
        });
        navigate("/inbox?view=sector");
        return;
      }

      if (mode === "single") {
        const created = await api<{ id: string }>("/v1/requests", {
          method: "POST",
          body: JSON.stringify({
            ...common,
            destinationSectorId: destinationSectorIds[0],
          }),
        });
        navigate(`/requests/${created.id}`);
        return;
      }

      const campaign = await api<{ campaignId: string; requestIds: string[] }>("/v1/campaigns", {
        method: "POST",
        body: JSON.stringify({
          ...common,
          destinationSectorIds,
        }),
      });

      navigate(`/campaigns/${campaign.campaignId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar a solicitação.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <Link className="text-link" to="/inbox">← Voltar</Link>
          <h1>Nova solicitação</h1>
          <p className="muted">Abra um pedido para um setor ou uma coleta para vários setores.</p>
        </div>
      </div>

      <form className="card stack" onSubmit={submit}>
        <div className="tabs">
          <button type="button" className={mode === "single" ? "active" : ""} onClick={() => {
            setMode("single");
            setDestinationSectorIds((current) => current.slice(0, 1));
          }}>
            Um setor
          </button>
          <button type="button" className={mode === "campaign" ? "active" : ""} onClick={() => setMode("campaign")}>
            Coleta multi-setor
          </button>
          {canSchedule && (
            <button type="button" className={mode === "recurrence" ? "active" : ""} onClick={() => setMode("recurrence")}>
              Recorrência
            </button>
          )}
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Setor de origem</span>
            <select value={originSectorId} onChange={(e) => setOriginSectorId(e.target.value)} required>
              <option value="">Selecione</option>
              {sectors.data?.data.filter((s) => s.active).map((sector) => (
                <option key={sector.id} value={sector.id}>{sector.name}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Modelo publicado</span>
            <select value={templateVersionId} onChange={(e) => setTemplateVersionId(e.target.value)}>
              <option value="">Sem modelo</option>
              {templates.data?.data
                .filter((template) => template.published_version_id)
                .map((template) => (
                  <option key={template.id} value={template.published_version_id ?? ""}>
                    {template.name} · v{template.published_version}
                  </option>
                ))}
            </select>
          </label>

          <label className="field">
            <span>Título</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} required />
          </label>

          <label className="field">
            <span>Competência</span>
            <input value={competence} onChange={(e) => setCompetence(e.target.value)} placeholder="2026-10" />
          </label>

          <label className="field">
            <span>{mode === "recurrence" ? "Primeira ocorrência" : "Prazo"}</span>
            <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} required />
          </label>

          {mode === "recurrence" && (
            <>
              <label className="field">
                <span>Frequência</span>
                <select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
                  <option value="MONTHLY">Mensal</option>
                  <option value="WEEKLY">Semanal</option>
                </select>
              </label>
              <label className="field">
                <span>Dias até o prazo de cada ocorrência</span>
                <input
                  type="number"
                  min={0}
                  max={90}
                  value={dueOffsetDays}
                  onChange={(e) => setDueOffsetDays(Number(e.target.value))}
                />
              </label>
            </>
          )}
        </div>

        <div>
          <strong>Setor(es) de destino</strong>
          <div className="check-grid">
            {availableDestinations.map((sector) => (
              <label className="check-card" key={sector.id}>
                <input
                  type={mode === "single" ? "radio" : "checkbox"}
                  name="destination"
                  checked={destinationSectorIds.includes(sector.id)}
                  onChange={() => {
                    if (mode === "single") setDestinationSectorIds([sector.id]);
                    else toggleDestination(sector.id);
                  }}
                />
                <span>{sector.name}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="field">
          <span>Instruções</span>
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </label>

        {error && <div className="alert error">{error}</div>}

        <div className="action-row">
          <button className="primary" disabled={busy}>
            {busy ? "Criando..." : mode === "single" ? "Criar solicitação" : mode === "campaign" ? "Criar coleta" : "Agendar recorrência"}
          </button>
          <Link className="button secondary" to="/inbox">Cancelar</Link>
        </div>
      </form>
      {canSchedule && <RecurrenceList sectorId={originSectorId} />}
    </section>
  );
}

function RecurrenceList({ sectorId }: { sectorId: string }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["recurrences", sectorId],
    queryFn: () => api<{ data: Array<{
      id: string;
      title: string;
      frequency: string;
      next_run_at: string;
      active: boolean;
    }> }>(`/v1/sectors/${sectorId}/recurrences`),
  });

  if (query.isLoading) return null;
  if (query.error) return <div className="alert error">{query.error.message}</div>;

  async function toggle(id: string, active: boolean) {
    await api(`/v1/recurrences/${id}/active`, {
      method: "POST",
      body: JSON.stringify({ active }),
    });
    await client.invalidateQueries({ queryKey: ["recurrences", sectorId] });
  }

  const rows = query.data?.data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="card table-card">
      <h2>Recorrências do setor</h2>
      <p className="muted">Pausar não apaga as ocorrências já criadas.</p>
      <table>
        <thead>
          <tr><th>Título</th><th>Frequência</th><th>Próxima</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.title}</td>
              <td>{row.frequency === "WEEKLY" ? "Semanal" : "Mensal"}</td>
              <td>{row.active ? new Date(row.next_run_at).toLocaleString("pt-BR") : "Pausada"}</td>
              <td>
                <button className="secondary" onClick={() => void toggle(row.id, !row.active)}>
                  {row.active ? "Pausar" : "Retomar"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
