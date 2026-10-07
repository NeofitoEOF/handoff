# Supply-chain de release

## Objetivo

A versão implantada em staging/produção deve ser exatamente o artefato produzido
pelo workflow de release, sem rebuild e sem depender de tag Docker mutável.

## Release

Tags Git `v*` acionam `.github/workflows/release.yml`.

Para API, worker e web o workflow:

1. constrói a imagem uma única vez;
2. publica em GHCR;
3. gera SBOM via BuildKit;
4. gera provenance BuildKit em modo máximo;
5. assina o digest OCI com Cosign keyless usando o OIDC do GitHub Actions;
6. verifica a assinatura recém-publicada;
7. registra os três digests em `release-manifest.json`.

O chart Helm é empacotado com versão derivada da tag Git.

A GitHub Release recebe:

- `release-manifest.json`;
- chart `handoff-<versão>.tgz`;
- `SHA256SUMS`.

## Promoção

O workflow `deploy.yml` recebe apenas:

- ambiente: staging ou production;
- release tag, por exemplo `v1.2.3`.

Antes de obter acesso ao cluster ele:

1. baixa os assets da GitHub Release;
2. valida `SHA256SUMS`;
3. confirma que o manifesto pertence à tag solicitada;
4. valida o formato SHA-256 dos três digests;
5. verifica com Cosign que cada imagem foi assinada pelo workflow
   `release.yml` deste repositório e pela identidade OIDC do GitHub.

Somente então o kubeconfig é carregado.

## Deploy por digest

O chart aceita `images.<componente>.digest`. Quando presente, a imagem renderiza
como:

```text
ghcr.io/neofitoeof/handoff-api@sha256:<digest>
```

O digest tem precedência sobre `tag`.

API, worker, web e o job de migration usam os digests do mesmo manifesto. O
workflow confirma após o rollout que os Deployments realmente contêm esses
digests.

## Rollback

Rollback é promoção de uma GitHub Release anterior já assinada. Não faça rebuild
de uma versão antiga.

Exemplo conceitual:

```text
Deploy -> production -> v1.2.2
```

A release anterior passa novamente pelas mesmas verificações de checksum e
assinatura antes do Helm upgrade.

## Regra operacional

Nunca copie uma tag Docker manualmente como mecanismo de promoção. A fonte de
verdade da versão é:

```text
Git tag -> signed OCI digest -> release-manifest.json -> Helm digest
```
