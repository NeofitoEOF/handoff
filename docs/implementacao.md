# Status de implementação

Este documento é o checklist vivo da implementação do Handoff. Atualizar no mesmo PR sempre que um bloco for concluído.

Legenda: ✅ implementado · 🟡 parcial · ⏳ pendente

## Fundação

- ✅ Workspace pnpm
- ✅ API Fastify + TypeScript estrito
- ✅ Configuração por variáveis de ambiente
- ✅ PostgreSQL 16 local via Docker Compose
- ✅ Health check
- ✅ JWT básico com `sub` e `tenantId`
- ✅ Transações com contexto RLS via `SET LOCAL app.tenant_id`
- ✅ CI com typecheck e testes
- ✅ Refresh token rotativo
- ✅ Login/senha + Argon2id
- ✅ MFA/TOTP com segredo cifrado
- ✅ Recuperação de senha com entrega por e-mail via outbox

## Multi-tenant e empresa

- ✅ Tabela de tenants
- ✅ Usuário global
- ✅ Vínculo usuário × tenant com papel ADMIN/AUDITOR/USER
- ✅ RLS nas tabelas tenant-scoped criadas até aqui
- 🟡 Teste automatizado de vazamento entre tenants — RLS pronto, suíte E2E pendente
- ✅ Cadastro assistido da empresa via endpoint interno de provisionamento
- ✅ Suspensão/inativação de tenant com revogação de sessões
- ✅ Exportação completa do tenant

## Setores e usuários

- ✅ Criar setor — somente Admin da Empresa
- ✅ Listar setores
- ✅ Adicionar/reativar membro no setor
- ✅ Gestor pode atribuir Membro/Aprovador
- ✅ Somente Admin pode nomear Gestor
- ✅ Remover/inativar membro
- ✅ Impedir remoção do último Gestor
- ✅ Desativar setor somente sem pendências abertas
- ✅ Convite com entrega por e-mail via outbox

## Solicitações

- ✅ Estrutura inicial de `requests`
- ✅ Criar solicitação entre setores
- ✅ Validar que autor pertence ao setor de origem
- ✅ Validar origem ≠ destino
- ✅ Prazo pertence ao setor desde a abertura
- ✅ Competência opcional
- ✅ Detecção inicial de duplicidade por competência
- ✅ Estado inicial OPEN sem responsável
- ✅ Reatribuição de responsável com motivo e auditoria
- ✅ Reatribuição não reinicia SLA
- ✅ Máquina de estados centralizada
- ✅ Testes unitários da máquina de estados
- ✅ Endpoint de atribuição inicial separado da reatribuição
- ✅ Estado automático Aguardando reatribuição em remoção/inativação do membro
- ✅ Alteração auditada de prazo
- ✅ Cancelamento com motivo
- ✅ Retificação de solicitação fechada
- ✅ Coleta/campanha multi-setor
- ✅ Recorrência configurável + materialização automática idempotente no worker

## Modelos

- ✅ Templates
- ✅ Versionamento imutável de template
- ✅ Campos e validações básicas
- ✅ Biblioteca inicial de modelos do fluxo piloto
- ✅ Criar modelo a partir de XLSX com inferência de campos

## Preenchimento

- ✅ Request items
- ✅ Persistência de rascunho/autosave via upsert
- ⏳ Formulário dinâmico
- ✅ Submissão
- ✅ Link sem conta + OTP + sessão limitada à solicitação
- ✅ Anexos/evidências com SHA-256 e Object Storage
- ✅ Upload XLSX
- ✅ Validação linha a linha + confirmação explícita
- ⏳ Quarentena/antivírus de arquivo

## Revisão e fechamento

- ✅ Revisão por item
- ✅ Aprovação parcial
- ✅ Devolução com comentário obrigatório
- ✅ Novo prazo de correção por item
- ✅ Maker-checker por pessoa/item
- ✅ Snapshot imutável com SHA-256
- ⏳ PDF de fechamento
- ✅ Retificação vinculada ao fechamento anterior

## Auditoria

- ✅ `audit_events` inicial
- ✅ Evento de criação de setor
- ✅ Evento de membership
- ✅ Evento de criação de solicitação
- ✅ Evento de reatribuição
- ✅ Proteção append-only por trigger
- ✅ Timeline por solicitação/item/evidência/importação
- ✅ Exportação CSV da trilha
- ⏳ Hash encadeado opcional

## Notificações, painel e integrações

- ✅ E-mail transacional via outbox + worker SMTP/log
- ✅ Lembretes de prazo pelo worker
- ✅ Escalonamento de atraso e solicitações sem responsável
- ✅ Caixa de entrada backend
- ✅ Indicadores por setor backend
- ⏳ Login Microsoft/Entra ID
- ⏳ Outlook/Teams

## Frontend

- ⏳ React + Vite
- ⏳ Login
- ⏳ Caixa de entrada
- ⏳ Solicitação
- ⏳ Revisão
- ⏳ Gestão de setor
- ⏳ Administração da empresa
- ⏳ Auditoria
