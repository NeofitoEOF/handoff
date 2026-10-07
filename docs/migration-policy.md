# Política de migrations

## Regra principal

Uma migration aplicada é imutável.

Depois que o arquivo foi registrado em `schema_migrations`, qualquer correção de
schema ou dados deve ser feita em **uma nova migration**. O migrador calcula
SHA-256 do arquivo e interrompe o deploy se o conteúdo atual não corresponder ao
checksum registrado no banco.

## Histórico

A tabela `schema_migrations` registra:

- `filename`;
- `checksum` SHA-256;
- `applied_at`.

Bancos que já existiam antes da adoção de checksum recebem o hash atual uma única
vez no primeiro upgrade compatível. Depois disso, divergência é erro fatal.

## Renumeração legada

Durante a preparação pré-go-live havia dois arquivos com prefixo `0026`. A
sequência foi normalizada para `0001..0031`.

O migrador conhece temporariamente os aliases antigos e atualiza apenas o
`filename` em `schema_migrations`; ele **não reaplica o SQL**. Se o banco
contiver simultaneamente o nome antigo e o atual, o deploy é interrompido para
investigação manual.

## Mudanças destrutivas

O CI bloqueia por padrão:

- DROP TABLE;
- DROP COLUMN;
- DROP SCHEMA;
- DROP TYPE;
- TRUNCATE;
- DELETE FROM.

Uma exceção exige comentário explícito no arquivo:

```sql
-- migration-safety: allow-destructive reason=<justificativa objetiva>
```

A exceção não torna a mudança automaticamente segura. Ela apenas registra que a
destruição foi deliberada e revisável.

## Expand/contract

Para produção:

1. **expand**: adicionar coluna/tabela/índice compatível;
2. implantar código capaz de conviver com schema antigo e novo;
3. migrar/backfill de dados quando necessário;
4. confirmar que versões antigas não dependem mais da estrutura;
5. **contract** em migration posterior, com revisão explícita.

Nunca dependa de rollback destrutivo de migration para recuperar uma versão da
aplicação.
