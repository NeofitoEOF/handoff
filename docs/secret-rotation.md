# Rotação de segredos

O Handoff foi preparado para receber segredos por Kubernetes Secret ou, de forma
recomendada, por External Secrets com um SecretStore/ClusterSecretStore ligado ao
OCI Vault.

## Segredos de rotação regular

- JWT_SECRET
- MFA_ENCRYPTION_KEY
- PLATFORM_ADMIN_KEY
- INTEGRATION_ENCRYPTION_KEY
- DATABASE_URL / senha da aplicação
- MIGRATION_DATABASE_URL / credencial administrativa
- OBJECT_STORAGE_ACCESS_KEY / OBJECT_STORAGE_SECRET_KEY
- SMTP_USER / SMTP_PASS
- METRICS_TOKEN
- MICROSOFT_CLIENT_SECRET

## Procedimento

1. criar a nova versão do segredo no cofre;
2. aguardar o External Secrets sincronizar o Kubernetes Secret;
3. reiniciar API/worker de forma controlada quando o segredo não puder ser
   recarregado em runtime;
4. validar health, login, upload, notificações e métricas;
5. revogar a versão anterior somente depois da validação;
6. registrar a rotação na mudança operacional.

Credenciais de banco devem aceitar sobreposição de versões durante a troca para
evitar indisponibilidade. Chaves criptográficas que protegem dados existentes não
devem ser substituídas sem estratégia explícita de recriptografia/versionamento.
