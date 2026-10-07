## Objetivo

Descreva a mudança e o problema que ela resolve.

## Impacto funcional

- [ ] Não altera regra de negócio
- [ ] Altera regra de negócio e a documentação/checklist foi atualizada
- [ ] Fluxo E2E afetado foi testado

## Banco de dados

- [ ] Não possui migration
- [ ] Migration é expand/contract e backward-compatible
- [ ] Migration destrutiva possui justificativa explícita e revisão adicional
- [ ] Rollback da aplicação continua possível após a migration

## Segurança e privacidade

- [ ] Não adiciona novo dado sensível/segredo
- [ ] RLS/autorização revisados quando aplicável
- [ ] Impacto LGPD revisado quando aplicável
- [ ] Logs não expõem credenciais ou dados sensíveis

## Operação

- [ ] Health/readiness continuam válidos
- [ ] Métricas/alertas foram atualizados quando necessário
- [ ] Existe estratégia de rollback
- [ ] Runbook/documentação operacional foi atualizada quando necessário

## Qualidade

- [ ] Typecheck
- [ ] Testes
- [ ] E2E local
- [ ] Helm lint
- [ ] Terraform validate
- [ ] Security workflow

## Release

- [ ] CHANGELOG atualizado quando a mudança for publicável
- [ ] Versão será alterada apenas no momento do release
- [ ] Imagens serão publicadas por tag/SHA imutável
