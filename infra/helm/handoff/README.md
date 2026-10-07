# Helm chart

Deploy do Handoff em Kubernetes/OKE.

## Pré-requisitos

- Kubernetes 1.28+
- ingress-nginx
- cert-manager
- metrics-server
- secret `handoff-secrets` ou ExternalSecret com as chaves exigidas pela API/worker

## Segredos mínimos

`DATABASE_URL`, `MIGRATION_DATABASE_URL`, `APP_DATABASE_USER`,
`APP_DATABASE_PASSWORD`, `JWT_SECRET`, `MFA_ENCRYPTION_KEY`,
`PLATFORM_ADMIN_KEY`, `INTEGRATION_ENCRYPTION_KEY`,
`OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_ACCESS_KEY`,
`OBJECT_STORAGE_SECRET_KEY`, além de SMTP quando habilitado.

## Deploy

```bash
helm upgrade --install handoff infra/helm/handoff \
  --namespace handoff --create-namespace \
  --set domain=handoff.exemplo.com \
  --set images.api.tag=<sha> \
  --set images.web.tag=<sha> \
  --set images.worker.tag=<sha>
```

O job de migration roda antes do rollout. API e web têm health probes; API e
worker possuem HPA por CPU como fallback inicial. Escala por profundidade de fila
fica para a adoção de um backend de fila dedicado.
