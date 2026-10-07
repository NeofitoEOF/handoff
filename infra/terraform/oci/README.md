# OCI Terraform

Infraestrutura base do Handoff em OCI.

Provisiona OKE pelo módulo oficial Oracle, Object Storage privado com versionamento,
OCI Vault com chave AES e OCI Database with PostgreSQL com PITR configurável.

## Uso

Autentique o provider OCI pelo método adotado no ambiente. Depois:

    cd infra/terraform/oci
    terraform init
    terraform plan
    terraform apply

Copie terraform.tfvars.example para um arquivo local não versionado e ajuste os
OCIDs, versões e tipos suportados na região.

A senha inicial do PostgreSQL deve ser injetada por variável sensível:

    export TF_VAR_postgres_admin_password='...'

Após o bootstrap, credenciais de runtime devem ficar no OCI Vault e ser
sincronizadas com Kubernetes via External Secrets.

O postgres_subnet_id é explícito para evitar acoplamento incorreto entre a rede do
banco e outputs internos do módulo OKE.
