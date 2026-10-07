# Handoff API

Fundação da Fase 1.

## Rodar localmente

1. Copie `.env.example` para `.env`.
2. Suba o PostgreSQL com `docker compose up -d postgres`.
3. Rode a migration `apps/api/migrations/0001_foundation.sql` no banco.
4. Instale dependências com `pnpm install`.
5. Inicie com `pnpm dev`.

## Primeiro fluxo implementado

`POST /v1/requests/:id/reassign`

A rota já aplica a regra operacional documentada:
- preserva SLA;
- valida que o novo responsável pertence ao setor de destino;
- impede reatribuição de solicitação finalizada;
- registra histórico de responsável;
- registra evento de auditoria;
- opera dentro de transação com contexto RLS do tenant.

Autenticação inicial usa JWT e espera `sub` e `tenantId` no token.
