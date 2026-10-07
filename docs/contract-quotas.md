# Quotas contratuais por empresa

O endpoint interno `PUT /internal/billing/tenants/:tenantId`, protegido pela
chave da plataforma, aceita os campos opcionais:

- `monthlyRequestLimit`: inteiro entre 0 e 2147483647; null remove a quota mensal.
- `storageLimitBytes`: inteiro seguro não negativo; null restaura o padrão do plano.

Campos omitidos preservam os limites existentes ao atualizar um perfil.
Sem perfil/contrato, solicitações mensais seguem ilimitadas. Starter e Business
mantêm 10 GiB e 100 GiB de armazenamento; Enterprise sem valor contratado segue
ilimitado. Os valores comerciais precisam ser cadastrados pela operação.

O resumo de cobrança retorna os limites efetivos; a Administração mostra
solicitações usadas/limite. O mês é civil em UTC, independente do fuso da empresa.
Solicitações canceladas continuam contando como criações. Retificações contam
como novas solicitações. Atualizações de solicitações existentes não consomem quota.

Migration 0034 aplica um trigger transacional com lock por empresa. Abrange
criação manual, campanhas, recorrências e retificações. Conflitos idempotentes
que não inserem linha não consomem quota. Campanhas que excedem o limite são
revertidas integralmente, sem solicitações parciais. A API responde 409 com
`monthly_request_limit` ou `billing_inactive`.

Recorrências bloqueadas conservam next_run_at e não registram execução parcial;
o worker tenta novamente nos próximos ciclos e continua notificações/outbox.
Se houver várias recorrências do tenant na mesma transação, todas são revertidas
juntas. O log identifica o tenant e a causa; elevar quota ou reativar cobrança
libera nova tentativa. No mês seguinte, aplica-se o novo orçamento.

Reduzir o limite abaixo do uso não apaga histórico: bloqueia novas criações ou
uploads. Aplicar migrations antes de atualizar API/worker. O ambiente real ainda
exige credenciais e configuração de infraestrutura; os limites contratuais não
ativam provisionamento ou deploy automaticamente.
