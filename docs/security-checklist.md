# Security checklist

## Pipeline

- Dependabot semanal para npm, GitHub Actions e imagens Docker.
- CodeQL para JavaScript/TypeScript em PR, main e execução semanal.
- Trivy em filesystem com resultados SARIF para vulnerabilidades HIGH/CRITICAL.
- CI funcional continua separado do workflow de segurança para facilitar diagnóstico.

## Aplicação

- JWT curto + refresh rotativo.
- MFA/TOTP.
- Rate limit e bloqueio temporário após falhas de login.
- RLS por tenant com usuário da aplicação sem BYPASSRLS.
- Auditoria append-only + cadeia de hash.
- XLSX/evidências passam por antivírus fail-closed.
- CORS limitado.
- Authorization/cookies redigidos dos logs.
- Webhooks Teams cifrados em repouso.
- URLs pré-assinadas de evidência com validade curta.

## Cluster

- containers non-root;
- root filesystem read-only nos deployments do chart;
- capabilities Linux removidas;
- PodDisruptionBudget para API e frontend;
- NetworkPolicy default-deny de entrada para pods do Handoff;
- entrada da API/web liberada somente para o ingress controller.

## Antes de produção

- validar labels reais do ingress-nginx do cluster e ajustar a NetworkPolicy;
- habilitar External Secrets/OCI Vault;
- habilitar WAF;
- configurar rotação de segredos;
- configurar alertas de segurança;
- executar DAST em staging;
- validar política de retenção e resposta a incidente LGPD.
