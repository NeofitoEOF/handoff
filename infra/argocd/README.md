# Argo CD

O manifesto `application.yaml` registra o chart do Handoff no Argo CD.

Antes de aplicar, ajuste:
- domínio;
- repositórios/tags das imagens;
- política de sincronização conforme o ambiente.

Produção deve usar tags imutáveis (versão ou SHA), nunca `latest`.
O secret `handoff-secrets` deve ser criado por External Secrets/OCI Vault antes
do primeiro sync.
