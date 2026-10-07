# Release governance

## Fonte de versão

A versão oficial do Handoff fica em `package.json` na raiz do monorepo e segue
SemVer.

Exemplo:

```json
{
  "version": "0.1.0"
}
```

A tag precisa ser exatamente `v<version>`.

## Changelog

Cada versão publicada precisa possuir uma seção própria em `CHANGELOG.md`.
Mudanças ainda não publicadas ficam em `[Unreleased]`.

Antes de criar uma tag:

1. mover as mudanças de Unreleased para a nova versão;
2. atualizar `package.json`;
3. executar CI completo;
4. revisar migration safety, E2E, Security e rollback;
5. criar tag assinada/protegida conforme política do repositório.

## Pipeline de release

Ao receber uma tag `v*`, o workflow:

1. valida tag x package.json x CHANGELOG;
2. constrói API, worker e web;
3. publica imagens no GHCR por tag e SHA;
4. produz SBOM/provenance;
5. assina imagens com Cosign;
6. verifica as assinaturas;
7. empacota Helm;
8. gera checksums e manifesto de release;
9. cria GitHub Release usando a seção da versão no CHANGELOG.

## Controle de mudança

PRs devem registrar impacto em:

- regra de negócio;
- migrations;
- segurança/LGPD;
- operação/observabilidade;
- rollback;
- release notes.

Mudança de schema destrutiva exige exceção explícita na migration e revisão
adicional. Produção usa expand/contract para manter rollback da aplicação.

## Produção

O deploy de produção deve usar GitHub Environment com required reviewers.
A versão implantada deve ser uma tag/SHA imutável já validada pelos workflows de
CI, Security e E2E.
