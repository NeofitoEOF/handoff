# Âncora WORM da auditoria

## Objetivo

A cadeia de `audit_events` já é append-only e encadeada por SHA-256 dentro do PostgreSQL.
A âncora WORM adiciona uma prova externa diária para dificultar a reescrita coordenada do banco e do histórico.

## Funcionamento

Uma vez por dia, o worker tenta ancorar o estado da cadeia referente ao **dia UTC anterior**.

Para cada tenant:

1. adquire advisory lock no PostgreSQL para impedir duas réplicas de criarem a mesma âncora;
2. verifica se a data já foi ancorada;
3. busca o último `audit_event` existente até o final daquele dia UTC;
4. cria um manifesto canônico contendo tenant, data, `chain_seq`, `chain_hash` e SHA-256 da âncora anterior;
5. calcula SHA-256 do próprio manifesto;
6. grava o manifesto no bucket dedicado de âncoras;
7. registra a âncora em `audit_anchors`, que também é append-only;
8. grava o evento `AUDIT_CHAIN_ANCHORED` na cadeia corrente.

A âncora aponta para o estado da cadeia **antes** do evento que registra a própria ancoragem.

## Manifesto

Exemplo:

```json
{
  "version": 1,
  "tenantId": "uuid",
  "anchorDate": "2026-10-06",
  "chainSeq": 1234,
  "chainHash": "sha256...",
  "previousAnchorSha256": "sha256-da-ancora-anterior"
}
```

O SHA-256 do arquivo é guardado no banco. A âncora seguinte referencia esse SHA, formando uma segunda cadeia entre os manifestos diários.

## Verificação

Admin/Auditor pode usar:

- `GET /v1/audit/anchors`
- `GET /v1/audit/anchors/verify`
- `GET /v1/audit/anchors/:id/download`

A verificação compara:

- `chain_seq`/`chain_hash` da âncora com o evento histórico correspondente no PostgreSQL;
- SHA-256 do manifesto baixado do Object Storage com `manifest_sha256` registrado;
- tenant, data, sequência e hash contidos no manifesto com o registro da âncora.

A tela **Auditoria** também permite executar a verificação e baixar o manifesto.

## Object Storage e WORM

Produção usa um bucket exclusivo para âncoras, separado dos anexos operacionais.

O Terraform configura:

- bucket privado;
- versionamento;
- retention rule;
- prazo padrão de 3650 dias, parametrizável;
- opção de `time_rule_locked`.

### Atenção ao lock

`audit_anchor_retention_rule_lock_at` deve permanecer `null` até a política ser validada no ambiente real.

Depois que uma retention rule da OCI é bloqueada, a operação é deliberadamente irreversível em condições normais: não trate o lock como simples configuração de aplicação.

Procedimento recomendado:

1. aplicar bucket/retention sem lock;
2. validar gravação e leitura das âncoras em staging;
3. validar período de retenção com Jurídico/Compliance;
4. validar restore/runbook e custos;
5. definir o timestamp RFC3339 do lock em produção;
6. revisar o `terraform plan` por segunda pessoa antes do apply.

## Desenvolvimento local

O Docker Compose cria `handoff-audit-anchors` no MinIO. O MinIO local serve para teste funcional; ele não substitui a garantia WORM configurada no OCI Object Storage de produção.
