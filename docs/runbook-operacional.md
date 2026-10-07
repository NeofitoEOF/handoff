# Runbook operacional

## Objetivos

- RPO alvo: **15 minutos**
- RTO alvo: **4 horas**
- backup gerenciado diário + PITR mínimo de 7 dias em produção
- restore drill automatizado mensal e teste manual antes de mudanças de alto risco

O dump lógico deste repositório é uma segunda linha de defesa e ferramenta de
validação. Em produção, PITR do PostgreSQL gerenciado continua sendo o mecanismo
primário de recuperação.

## Incidente de aplicação

1. confirmar erro/latência e identificar versão implantada;
2. pausar rollout automático;
3. se o erro estiver ligado a um release recente, retornar API/web/worker à tag
   imutável anterior via Helm/Argo CD;
4. **não executar rollback destrutivo de migration**. As migrations de produção
   seguem expand/contract e a aplicação anterior deve permanecer compatível;
5. se necessário, pausar o worker antes da API para impedir novos efeitos
   assíncronos;
6. registrar início, impacto, tenant(s) afetados, ações e horário da recuperação.

## Falha de banco / corrupção

1. colocar aplicação em modo indisponível ou somente leitura no balanceador;
2. interromper workers;
3. determinar ponto seguro de recuperação;
4. restaurar via PITR em uma instância nova;
5. validar migrations, contagem de tenants, cadeia de auditoria e amostra de
   solicitações fechadas;
6. trocar a conexão somente após validação;
7. manter banco anterior isolado para análise até encerramento do incidente.

## Restore lógico

```bash
export DATABASE_URL='postgres://...'
./scripts/backup-postgres.sh backup.dump

# em banco de recuperação vazio
export DATABASE_URL='postgres://.../handoff_restore'
./scripts/restore-postgres.sh backup.dump
```

Nunca execute o script de restore diretamente sobre produção sem janela e
procedimento de incidente aprovado.

## Verificações pós-restore

- migrations esperadas presentes;
- tenants e setores consultáveis;
- RLS ativo com usuário da aplicação;
- `GET /v1/audit/verify` válido para tenants amostrados;
- snapshots fechados continuam com SHA-256 esperado;
- objetos/evidências referenciados existem no Object Storage;
- worker volta sem backlog duplicado;
- login, criação de solicitação e leitura de fechamento passam no smoke test.

## Rollback de aplicação

Produção usa imagem por SHA ou versão, nunca `latest`.

```bash
helm upgrade handoff infra/helm/handoff \
  -n handoff \
  --reuse-values \
  --set images.api.tag=<sha-anterior> \
  --set images.web.tag=<sha-anterior> \
  --set images.worker.tag=<sha-anterior>
```

Se uma migration expand/contract já tiver sido aplicada, o rollback da aplicação
não remove colunas/tabelas novas. A etapa contract só deve ocorrer depois que
nenhuma versão suportada depender da estrutura antiga.

## Severidade

- **SEV-1:** vazamento entre tenants, perda/corrupção de dados, autenticação
  comprometida ou indisponibilidade ampla.
- **SEV-2:** fluxo crítico indisponível para parte relevante dos clientes,
  importações/fechamentos parados.
- **SEV-3:** degradação parcial com alternativa operacional.

SEV-1 exige preservar logs/evidências, rotacionar credenciais quando aplicável e
tratar comunicação/LGPD conforme avaliação jurídica e de segurança.
