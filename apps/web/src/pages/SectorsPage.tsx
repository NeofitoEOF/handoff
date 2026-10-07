import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";

type Sector = {
  id: string;
  name: string;
  active: boolean;
};

export function SectorsPage() {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  const sectors = useQuery({
    queryKey: ["sectors"],
    queryFn: () => api<{ data: Sector[] }>("/v1/sectors"),
  });

  const create = useMutation({
    mutationFn: () =>
      api("/v1/sectors", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: async () => {
      setName("");
      setMessage("Setor criado.");
      await client.invalidateQueries({ queryKey: ["sectors"] });
    },
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    await create.mutateAsync();
  }

  async function deactivate(id: string) {
    await api(`/v1/sectors/${id}/deactivate`, { method: "POST" });
    setMessage("Setor desativado.");
    await client.invalidateQueries({ queryKey: ["sectors"] });
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Setores</h1>
          <p className="muted">Administração delegada por área.</p>
        </div>
      </div>

      {message && <div className="alert success">{message}</div>}
      {create.error && <div className="alert error">{create.error.message}</div>}

      <form className="card inline-form" onSubmit={submit}>
        <label className="field">
          <span>Novo setor</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button className="primary" disabled={create.isPending}>Criar</button>
      </form>

      <div className="card table-card">
        <table>
          <thead>
            <tr><th>Setor</th><th>Status</th><th>Ações</th></tr>
          </thead>
          <tbody>
            {sectors.data?.data.map((sector) => (
              <tr key={sector.id}>
                <td><Link className="text-link" to={`/sectors/${sector.id}`}>{sector.name}</Link></td>
                <td>{sector.active ? "Ativo" : "Inativo"}</td>
                <td>
                  {sector.active && (
                    <button className="danger" onClick={() => void deactivate(sector.id)}>
                      Desativar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
