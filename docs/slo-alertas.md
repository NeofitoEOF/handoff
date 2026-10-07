# SLOs e alertas operacionais

## Objetivos iniciais

- Disponibilidade da API: 99,9% mensal.
- Integridade do banco: conectividade da API com PostgreSQL deve permanecer disponível.
- Erros HTTP 5xx: alvo abaixo de 1% em janela operacional; alerta inicial em 5% por 5 minutos.
- RTO: 4 horas.
- RPO: 15 minutos.

Os valores são iniciais e devem ser recalibrados após dados reais de staging/produção.

## Alertas

### HandoffApiDown

Dispara quando o target Prometheus da API permanece indisponível por 2 minutos.

Ações:
1. verificar rollout/pods da API;
2. verificar ingress e Service;
3. checar eventos Kubernetes;
4. se ligado a release recente, aplicar rollback conforme runbook operacional.

### HandoffDatabaseUnavailable

Dispara quando handoff_database_up fica 0 por 1 minuto.

Ações:
1. verificar endpoint/estado do OCI PostgreSQL;
2. validar NetworkPolicy, DNS e credenciais;
3. pausar worker se houver risco de efeitos parciais;
4. iniciar procedimento de recuperação se houver corrupção/indisponibilidade prolongada.

### HandoffHigh5xxRate

Dispara quando a proporção de respostas 5xx ultrapassa 5% por 5 minutos.

Ações:
1. identificar rotas com maior erro;
2. correlacionar logs com deploy recente;
3. verificar banco/Object Storage/SMTP/Gotenberg/ClamAV conforme a rota;
4. aplicar rollback se a regressão estiver ligada à versão nova.

## Probes

- /live: somente processo; não consulta dependências.
- /ready: consulta PostgreSQL; pod não recebe tráfego se o banco não estiver acessível.
- /health: mantido por compatibilidade e continua verificando PostgreSQL.

## Ativação no Helm

Ative apenas quando Prometheus Operator/CRDs estiverem presentes no cluster:

    observability:
      serviceMonitor:
        enabled: true
      prometheusRule:
        enabled: true

Alertas devem ser ligados ao Alertmanager do ambiente e encaminhados para o canal operacional adotado pela empresa.
