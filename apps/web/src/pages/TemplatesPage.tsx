import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

type Sector = { id: string; name: string; active: boolean };
type Template = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  published_version_id: string | null;
  published_version: number | null;
};
type LibraryTemplate = {
  id: string;
  code: string;
  name: string;
  sector_hint: string;
  description: string | null;
};

export function TemplatesPage() {
  const client = useQueryClient();
  const [sectorId, setSectorId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const sectors = useQuery({
    queryKey: ["sectors"],
    queryFn: () => api<{ data: Sector[] }>("/v1/sectors"),
  });

  const templates = useQuery({
    queryKey: ["templates", sectorId],
    queryFn: () => api<{ data: Template[] }>(`/v1/sectors/${sectorId}/templates`),
    enabled: !!sectorId,
  });

  const library = useQuery({
    queryKey: ["template-library"],
    queryFn: () => api<{ data: LibraryTemplate[] }>("/v1/template-library"),
  });

  async function clone(libraryId: string) {
    if (!sectorId) {
      setError("Selecione um setor.");
      return;
    }
    setError("");
    try {
      await api(`/v1/sectors/${sectorId}/templates/clone-library/${libraryId}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setMessage("Modelo clonado para o setor.");
      await client.invalidateQueries({ queryKey: ["templates", sectorId] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao clonar modelo.");
    }
  }

  async function fromXlsx(file: File) {
    if (!sectorId) {
      setError("Selecione um setor antes de importar.");
      return;
    }
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      await api(`/v1/sectors/${sectorId}/templates/from-xlsx`, {
        method: "POST",
        body: form,
      });
      setMessage("Modelo inferido a partir do XLSX. Revise antes de publicar.");
      await client.invalidateQueries({ queryKey: ["templates", sectorId] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao criar modelo.");
    }
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Modelos</h1>
          <p className="muted">Contratos de dados versionados por setor.</p>
        </div>
      </div>

      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="card action-row">
        <label className="field grow-field">
          <span>Setor</span>
          <select value={sectorId} onChange={(e) => setSectorId(e.target.value)}>
            <option value="">Selecione</option>
            {sectors.data?.data.filter((s) => s.active).map((sector) => (
              <option key={sector.id} value={sector.id}>{sector.name}</option>
            ))}
          </select>
        </label>
        <label className="button secondary file-button">
          Criar a partir de XLSX
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void fromXlsx(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <div className="card table-card">
        <h2>Modelos do setor</h2>
        {!sectorId ? (
          <div className="empty-state">Selecione um setor.</div>
        ) : templates.data?.data.length ? (
          <table>
            <thead><tr><th>Modelo</th><th>Versão publicada</th><th>Status</th></tr></thead>
            <tbody>
              {templates.data.data.map((template) => (
                <tr key={template.id}>
                  <td>
                    <strong>{template.name}</strong>
                    {template.description && <div className="small muted">{template.description}</div>}
                  </td>
                  <td>{template.published_version ?? "Rascunho"}</td>
                  <td>{template.active ? "Ativo" : "Inativo"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">Nenhum modelo no setor.</div>
        )}
      </div>

      <div className="card">
        <h2>Biblioteca inicial</h2>
        <div className="library-grid">
          {library.data?.data.map((template) => (
            <article className="library-card" key={template.id}>
              <div className="eyebrow">{template.sector_hint}</div>
              <h3>{template.name}</h3>
              <p className="muted">{template.description}</p>
              <button className="secondary" disabled={!sectorId} onClick={() => void clone(template.id)}>
                Clonar para o setor
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
