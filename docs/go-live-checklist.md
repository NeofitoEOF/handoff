# Go-live checklist

## Antes do corte

- CI e Security verdes na versão a implantar.
- Terraform fmt/validate e Helm lint verdes.
- Imagens publicadas por SHA/tag imutável.
- Terraform plan revisado por segunda pessoa.
- PostgreSQL com PITR e política de backup ativas.
- Restore drill recente concluído.
- OCI Vault/External Secrets sincronizando sem erro.
- DNS, TLS e ingress validados em staging.
- WAF criado e regras básicas habilitadas.
- DAST de staging executado e achados HIGH/CRITICAL tratados.
- Alertas de health, erro HTTP, CPU/memória e banco configurados.
- Conta/tenant de smoke dedicada criada sem dados reais.

## Corte

1. aplicar infraestrutura aprovada;
2. confirmar banco e Object Storage privados;
3. instalar dependências do cluster: ingress, cert-manager, metrics-server,
   External Secrets e observabilidade;
4. sincronizar segredos;
5. executar Helm/Argo CD com tags imutáveis;
6. migration hook precisa concluir antes do rollout;
7. validar readiness/liveness;
8. executar Deployment Smoke;
9. executar uma solicitação piloto entre dois setores;
10. confirmar notificações, auditoria e fechamento.

## Critérios de rollback

Rollback imediato quando houver:
- falha de isolamento entre tenants;
- login indisponível de forma ampla;
- migrations inconsistentes;
- perda/corrupção de dados;
- taxa de erro sustentada incompatível com operação;
- fechamento ou auditoria gerando dados inválidos.

Rollback de aplicação usa imagens anteriores e nunca desfaz migration destrutiva.
Consulte docs/runbook-operacional.md.

## Após o corte

- acompanhar métricas e logs durante o período de estabilização;
- validar workers/outbox e ausência de backlog anormal;
- confirmar backup/PITR após o primeiro ciclo;
- registrar versão implantada, horário e responsáveis;
- revisar incidentes/alertas e abrir ações corretivas.
