# Limite de tráfego por empresa

`TENANT_RATE_LIMIT_PER_MINUTE` define o orçamento agregado da empresa para
requisições autenticadas. Padrão: 1000 por minuto; intervalo permitido: 1 a
1000000. Configure a mesma variável em todas as réplicas da API.

JWT, API key e sessão de convidado compartilham um contador PostgreSQL após
validação da credencial. Credenciais inválidas não consomem o orçamento de uma
empresa. Login, OTP e endpoints anônimos continuam com os limites locais por IP.
Workers e probes não consomem esse orçamento.

O contador usa janelas de minuto do relógio do banco e upsert atômico. Existe uma
linha por tenant; janelas antigas são substituídas, sem tarefa de limpeza. RLS
isola os registros. Uma janela fixa permite rajadas na fronteira entre minutos;
o limite não representa quota comercial de solicitações criadas.

Ao esgotar o orçamento, a API responde 429 e `Retry-After` em segundos. Clientes
devem aguardar esse intervalo, adicionando jitter ao retry. Falha no banco mantém
a API fechada para tráfego autenticado, sem fallback por instância.

Aplicar migration 0033 antes de atualizar a API. O controle acrescenta uma
transação curta por autenticação e serializa atualizações do mesmo tenant;
monitorar latência e contenção antes de elevar o limite.
