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
  const [mappingHeaders, setMappingHeaders] = useState<string[]>([]);
  const [mappingFields, setMappingFields] = useState<Array<{ key: string; label: string }>>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mappingConfidence, setMappingConfidence] = useState<Record<string, number>>({});

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

  async function suggestMapping(file: File) {
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api<{
        headers: string[];
        fields: Array<{ key: string; label: string }>;
        mapping: Record<string, string>;
        confidence: Record<string, number>;
      }>(`/v1/templates/${id}/import-mappings/suggest`, {
        method: "POST",
        body: form,
      });
      setMappingHeaders(result.headers);
      setMappingFields(result.fields);
      setMapping(result.mapping);
      setMappingConfidence(result.confidence);
      setMessage("Sugestão gerada. Revise o mapeamento antes de salvar.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao analisar o relatório do ERP.");
    }
  }

  async function saveMapping() {
    setError("");
    try {
      await api(`/v1/templates/${id}/import-mappings/Padrão`, {
        method: "PUT",
        body: JSON.stringify({
          mapping,
          sourceHeaders: mappingHeaders,
        }),
      });
      setMessage("Mapeamento padrão do ERP salvo.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar o mapeamento.");
    }
  }

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
                  : "Revise os campos antes de publicar. Campos calculados, visibilidade por papel e alçada ficam no JSON."}
              </p>
            </div>
            <span className={`status status-${selected.status.toLowerCase()}`}>{selected.status}</span>
          </div>

          <pre className="schema-help">{`{
  "fields": [
    { "key": "valor", "label": "Valor", "type": "MONEY", "required": true },
    { "key": "salario", "label": "Salário", "type": "MONEY", "visibleTo": ["APPROVER", "MANAGER"] },
    { "key": "total", "label": "Total", "type": "MONEY", "calculation": { "op": "COLUMN_SUM", "field": "valor" } }
  ],
  "approvalPolicy": { "fieldKey": "valor", "threshold": 20000 }
}`}</pre>
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

      <div className="card">
        <div className="page-header compact-header">
          <div>
            <h2>Mapeamento de ERP</h2>
            <p className="muted">
              Envie um XLSX real do ERP. O Handoff sugere o vínculo de cabeçalhos e o Gestor confirma uma vez.
            </p>
          </div>
          <label className="button secondary file-button">
            Analisar XLSX
            <input
              type="file"
              accept=".xlsx"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void suggestMapping(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>

        {mappingFields.length > 0 ? (
          <>
            <div className="mapping-grid">
              {mappingFields.map((field) => (
                <label className="field mapping-row" key={field.key}>
                  <span>
                    {field.label}
                    {mappingConfidence[field.key] !== undefined && (
                      <small className="muted">
                        {" "}· confiança {Math.round((mappingConfidence[field.key] ?? 0) * 100)}%
                      </small>
                    )}
                  </span>
                  <select
                    value={mapping[field.key] ?? ""}
                    onChange={(event) =>
                      setMapping((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Não mapear</option>
                    {mappingHeaders.map((header) => (
                      <option key={header} value={header}>{header}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button className="primary" onClick={() => void saveMapping()}>
              Salvar mapeamento padrão
            </button>
          </>
        ) : (
          <div className="empty-state">Nenhum relatório analisado nesta sessão.</div>
        )}
      </div>
    </section>
  );
}
