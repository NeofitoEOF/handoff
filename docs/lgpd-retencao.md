# LGPD e retenção

## Política de retenção

Cada tenant possui uma política de retenção configurável, com padrão de **5 anos**.

O sistema expõe um relatório de solicitações `CLOSED` ou `CANCELLED` que já ultrapassaram a janela configurada.

O Handoff **não executa exclusão destrutiva automática** neste momento. Isso evita remover evidências fiscais, contábeis ou trabalhistas apenas porque um prazo genérico venceu. O relatório serve para revisão explícita do Admin/Encarregado antes de qualquer procedimento de descarte.

Endpoints:

- `GET /v1/admin/compliance`
- `PATCH /v1/admin/compliance`
- `GET /v1/admin/compliance/retention-candidates`

## Pedidos de titular

Tipos registrados:

- `ACCESS`
- `CORRECTION`
- `ERASURE`
- `RESTRICTION`

Estados:

- `OPEN`
- `IN_REVIEW`
- `COMPLETED`
- `REJECTED`

Endpoints:

- `POST /v1/admin/data-subject-requests`
- `GET /v1/admin/data-subject-requests`
- `PATCH /v1/admin/data-subject-requests/:id`
- `GET /v1/admin/data-subjects/:userId/export`

## Exportação do titular

A exportação consolida, dentro do tenant:

- cadastro do usuário;
- papel no tenant;
- memberships/setores;
- solicitações criadas ou atribuídas;
- atividade em itens;
- comentários;
- metadados de evidências enviadas;
- eventos de auditoria produzidos pelo usuário.

A exportação não inclui segredos, tokens, senhas, conteúdo cifrado ou URLs internas do storage.

Toda abertura, atualização e exportação de pedido de titular gera evento de auditoria append-only.

## Exclusão e restrição

Pedidos de `ERASURE` e `RESTRICTION` são registrados e acompanhados pelo sistema, mas a conclusão não dispara remoção automática de histórico auditável.

Antes de eliminar ou anonimizar dados é necessário avaliar:

- obrigação legal/regulatória de retenção;
- exercício regular de direitos;
- existência de vínculos em outros tenants;
- impacto sobre evidências e snapshots já aprovados.

Esse desenho mantém o atendimento operacional do pedido sem transformar uma ação jurídica sensível em exclusão automática irreversível.
