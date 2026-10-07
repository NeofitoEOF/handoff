import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
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
  const [mode, setMode] = useState<"single" | "campaign">("single");
  const [originSectorId, setOriginSectorId] = useState("");
  const [destinationSectorIds, setDestinationSectorIds] = useState<string[]>([]);
  const [templateVersionId, setTemplateVersionId] = useState("");
  const [title, setTitle] = useState("");
  const [competence, setCompetence] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

      if (campaign.requestIds[0]) {
        navigate(`/requests/${campaign.requestIds[0]}`);
      } else {
        navigate("/inbox?view=sector");
      }
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
            <span>Prazo</span>
            <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} required />
          </label>
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
            {busy ? "Criando..." : mode === "single" ? "Criar solicitação" : "Criar coleta"}
          </button>
          <Link className="button secondary" to="/inbox">Cancelar</Link>
        </div>
      </form>
    </section>
  );
}
