# Environment setup

Este documento lista as variáveis e segredos esperados pelos workflows de provisionamento e deploy.

## GitHub Environment: staging / production

### Variables

- OCI_REGION
- OCI_HOME_REGION
- OCI_POSTGRES_VERSION
- OCI_POSTGRES_SYSTEM_TYPE
- OCI_POSTGRES_STORAGE_SYSTEM_TYPE
- OCI_WAF_ENABLED
- OCI_WAF_LOAD_BALANCER_ID
- HANDOFF_DOMAIN
- SERVICE_MONITOR_ENABLED
- SMOKE_API_URL
- SMOKE_WEB_URL
- STAGING_SMOKE_SUBDOMAIN

### Secrets

- OCI_TENANCY_ID
- OCI_COMPARTMENT_ID
- OCI_POSTGRES_SUBNET_ID
- OCI_POSTGRES_ADMIN_PASSWORD
- OCI_USER_OCID
- OCI_FINGERPRINT
- OCI_PRIVATE_KEY
- KUBECONFIG_B64
- STAGING_SMOKE_EMAIL
- STAGING_SMOKE_PASSWORD
- STAGING_SMOKE_OTP

## Proteções recomendadas

- staging: aprovação opcional;
- production: required reviewers obrigatórios;
- bloquear self-approval em produção;
- segredos separados por environment;
- usar tags/SHA imutáveis;
- não guardar kubeconfig ou chave OCI no repositório.

## Fluxo

1. PR altera Terraform -> workflow Terraform Plan;
2. revisão do plan;
3. Terraform Apply manual com confirmação APPLY;
4. release gera imagens;
5. Deploy manual usa tag/SHA imutável;
6. Helm espera rollout;
7. smoke roda automaticamente;
8. DAST pode ser executado após o deploy de staging.
