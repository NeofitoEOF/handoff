import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { TemplateSchema } from "../types";

type TemplateVersion = {
  id: string;
  version: number;
  schema_json: TemplateSchema;
  status: "DRAFT" | "PUBLISHED";
  created_at: string;
  published_at: string | null;
};

type Detail = {
  template: {
    id: string;
    sector_id: string;
    name: string;
    description: string | null;
    active: boolean;
  };
  versions: TemplateVersion[];
};

export function TemplateDetailPage() {
  const { id = "" } = useParams();
  const client = useQueryClient();
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [schemaText, setSchemaText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const query = useQuery({
    queryKey: ["template-detail", id],
    queryFn: () => api<Detail>(`/v1/templates/${id}`),
    enabled: !!id,
  });

  const selected = useMemo(
    () => query.data?.versions.find((version) => version.id === selectedVersionId) ?? query.data?.versions[0],
    [query.data, selectedVersionId],
  );

  useEffect(() => {
    if (!selected) return;
    setSelectedVersionId(selected.id);
    setSchemaText(JSON.stringify(selected.schema_json, null, 2));
  }, [selected?.id]);

  async function saveDraft() {
    if (!selected || selected.status !== "DRAFT") return;
    setError("");
    try {
      const schema = JSON.parse(schemaText) as TemplateSchema;
      if (!Array.isArray(schema.fields) || schema.fields.length === 0) {
        throw new Error("O schema precisa conter ao menos um campo.");
      }

      await api(`/v1/templates/${id}/versions/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ schema }),
      });
      setMessage("Rascunho salvo.");
      await client.invalidateQueries({ queryKey: ["template-detail", id] });
      await client.invalidateQueries({ queryKey: ["templates"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar.");
    }
  }

  async function publish() {
    if (!selected || selected.status !== "DRAFT") return;
    setError("");
    try {
      await api(`/v1/templates/${id}/versions/${selected.id}/publish`, {
        method: "POST",
      });
      setMessage(`Versão ${selected.version} publicada. Ela agora é imutável.`);
      await client.invalidateQueries({ queryKey: ["template-detail", id] });
      await client.invalidateQueries({ queryKey: ["templates"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao publicar.");
    }
  }

  async function newVersion() {
    setError("");
    try {
      const base = selected?.schema_json ?? { fields: [] };
      const created = await api<TemplateVersion>(`/v1/templates/${id}/versions`, {
        method: "POST",
        body: JSON.stringify({ schema: base }),
      });
      setSelectedVersionId(created.id);
      setMessage(`Rascunho v${created.version} criado.`);
      await client.invalidateQueries({ queryKey: ["template-detail", id] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao criar nova versão.");
    }
  }

  if (query.isLoading) return <p>Carregando...</p>;
  if (query.error) return <div className="alert error">{query.error.message}</div>;
  if (!query.data || !selected) return <div className="empty-state">Modelo sem versões.</div>;

  return (
    <section>
      <div className="page-header">
        <div>
          <Link className="text-link" to="/templates">← Modelos</Link>
          <h1>{query.data.template.name}</h1>
          <p className="muted">{query.data.template.description ?? "Sem descrição."}</p>
        </div>
        <button className="secondary" onClick={() => void newVersion()}>Nova versão</button>
      </div>

      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="request-grid">
        <div className="card">
          <h2>Versões</h2>
          <div className="version-list">
            {query.data.versions.map((version) => (
              <button
                key={version.id}
                className={`version-button ${selected.id === version.id ? "active" : ""}`}
                onClick={() => setSelectedVersionId(version.id)}
              >
                <span>v{version.version}</span>
                <span className={`status status-${version.status.toLowerCase()}`}>{version.status}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="page-header compact-header">
            <div>
              <h2>Schema · v{selected.version}</h2>
              <p className="muted">
                {selected.status === "PUBLISHED"
                  ? "Publicado e imutável."
                  : "Revise os campos antes de publicar."}
              </p>
            </div>
            <span className={`status status-${selected.status.toLowerCase()}`}>{selected.status}</span>
          </div>

          <label className="field">
            <span>JSON do modelo</span>
            <textarea
              className="schema-editor mono"
              value={schemaText}
              onChange={(event) => setSchemaText(event.target.value)}
              disabled={selected.status === "PUBLISHED"}
            />
          </label>

          {selected.status === "DRAFT" && (
            <div className="action-row">
              <button className="secondary" onClick={() => void saveDraft()}>Salvar rascunho</button>
              <button className="primary" onClick={() => void publish()}>Publicar versão</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
