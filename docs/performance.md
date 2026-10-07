# Performance

## Metas iniciais

- leitura API: p95 < 300 ms;
- escrita API: p95 < 800 ms;
- XLSX com 10.000 linhas: validação < 60 s;
- arquitetura alvo inicial: 200 tenants / 5.000 usuários ativos.

## Controles implementados

- caixa de entrada paginada, 50 registros por padrão e máximo 100;
- índices parciais/compostos para memberships, prazo, responsável, revisão e itens;
- benchmark automatizado da validação XLSX de 10.000 linhas;
- smoke de carga HTTP sem dependência externa.

## Smoke em staging

```bash
HANDOFF_BASE_URL=https://staging.exemplo.com \
HANDOFF_LOAD_PATH=/health \
HANDOFF_LOAD_CONCURRENCY=20 \
HANDOFF_LOAD_REQUESTS=500 \
HANDOFF_LOAD_P95_MS=300 \
node scripts/load-smoke.mjs
```

Para endpoints autenticados, o script deve ser evoluído para receber token ou usar
um cenário específico de carga. O smoke atual mede infraestrutura/rede/API básica
e não substitui um teste de carga completo com dados representativos.

## Próxima calibração

As metas e índices devem ser revisitados após dados reais dos primeiros clientes.
Não aumentar limites de XLSX ou paginação sem medir CPU, memória e latência do
worker/API.
