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
- 🟡 Teste automatizado de vazamento entre tenants implementado com usuário sem BYPASSRLS; aguardando validação do CI
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
- ✅ Formulário dinâmico web a partir do schema publicado
- ✅ Submissão
- ✅ Link sem conta + OTP + sessão limitada à solicitação
- ✅ Anexos/evidências com SHA-256 e Object Storage
- ✅ Upload XLSX
- ✅ Validação linha a linha + confirmação explícita
- ✅ Antivírus ClamAV obrigatório antes de persistir/liberar arquivo

## Revisão e fechamento

- ✅ Revisão por item
- ✅ Aprovação parcial
- ✅ Devolução com comentário obrigatório
- ✅ Novo prazo de correção por item
- ✅ Maker-checker por pessoa/item
- ✅ Snapshot imutável com SHA-256
- ✅ PDF de fechamento assíncrono com Gotenberg + SHA-256 + download pré-assinado
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
- ✅ Login + refresh + MFA + recuperação Microsoft/Entra ID
- ✅ Avisos no Outlook por e-mail transacional + Teams via Microsoft Workflows webhook cifrado

## Frontend

- ✅ React + Vite
- ⏳ Login
- ✅ Caixa de entrada
- ✅ Solicitação completa: criar, atribuir, preencher, importar, evidência, exportar, fechar/retificar
- ✅ Revisão parcial por item
- ✅ Gestão de setor, membros, convites e indicadores
- ✅ Administração básica, MFA e exportação do tenant
- ✅ Auditoria/timeline e exportação CSV


## Colaboração e arquivos

- ✅ Comentários auditáveis por solicitação/item/campo
- ✅ Listagem de evidências com download pré-assinado de 5 minutos
- ✅ Exportação da solicitação para XLSX e CSV com mitigação de formula injection
- ✅ Convidado por link pode preencher formulário, importar XLSX e anexar evidência
- ✅ Autoria de convidado preservada em imports, evidências, snapshot e PDF

## Segurança operacional

- ✅ Rate limit global e reforçado em login/OTP/reset
- ✅ Bloqueio temporário após 5 falhas de login por conta
- ✅ CORS limitado às origens configuradas
- ✅ Redação de Authorization/cookies nos logs
- ✅ Banco separa usuário de migração e usuário de aplicação sem BYPASSRLS
- ✅ ClamAV fail-closed em todos os caminhos de XLSX/evidência


## Integrações Microsoft

- ✅ Entra ID por tenant com Authorization Code + PKCE
- ✅ State/nonce persistidos e uso único
- ✅ ID token validado por JWKS, issuer, audience e tenant
- ✅ Login Microsoft somente para usuário já vinculado ao tenant Handoff
- ✅ Webhook Teams cifrado AES-256-GCM; URL nunca retornada pela API
- ✅ Outbox Teams com idempotência e retry
- ✅ Outlook atendido pelos e-mails transacionais existentes

## Fase 2 — adoção

- ✅ Campos calculados por item: soma, subtração, multiplicação e percentual
- ✅ Total de coluna derivado no backend
- ✅ Biblioteca de modelos
- ✅ Criar modelo a partir de XLSX
- ✅ Mapeamento de cabeçalhos do ERP salvo por modelo
- ✅ Sugestão inicial de mapeamento por similaridade/sinônimos com confiança
