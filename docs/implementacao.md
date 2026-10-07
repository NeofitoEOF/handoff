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
- ✅ Teste automatizado de vazamento entre tenants com usuário sem BYPASSRLS validado no CI
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
- ✅ Hash encadeado por tenant + verificação de integridade + teste de integração

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
- ✅ Login por senha + MFA + Microsoft + recuperação de senha
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


## Infraestrutura e operação

- ✅ Dockerfile da API
- ✅ Dockerfile do worker
- ✅ Dockerfile do frontend com NGINX non-root
- ✅ Helm chart para Kubernetes/OKE
- ✅ Deployments de API, web e worker
- ✅ Services e Ingress com domínio raiz, wildcard de tenants e subdomínio da API
- ✅ TLS preparado para cert-manager
- ✅ Job de migration antes de install/upgrade
- ✅ Readiness/liveness probes para API e web
- ✅ HPA inicial para API e worker
- ✅ Release por tag com publicação das três imagens no GHCR
- ✅ Manifesto Argo CD para GitOps
- ✅ Métricas Prometheus básicas em `/internal/metrics`
- ✅ Endpoint de métricas protegido por Bearer token em produção
- ✅ ServiceMonitor opcional no Helm
- ✅ CI ampliado com build dos apps, build das imagens e `helm lint`
- ✅ External Secrets parametrizado no Helm + rotação documentada; aplicação no OCI Vault depende apenas do ambiente
- ✅ IaC OCI validado: OKE, Object Storage, Vault e Database with PostgreSQL; apply depende apenas de OCIDs/credenciais do ambiente


## Qualidade e aceite

- ✅ Máquina de estados com testes unitários
- ✅ Isolamento RLS entre tenants com teste em PostgreSQL real
- ✅ Cadeia de auditoria com teste de integração
- ✅ Aceite: criar → atribuir → reatribuir preservando SLA
- ✅ Aceite: maker-checker para usuário presente em dois setores
- ✅ Aceite: aprovação parcial com item aprovado bloqueado
- ✅ Aceite: devolução + correção + reenvio + aprovação final
- ✅ Aceite: fechamento + snapshot + retificação sem reabrir original
- ✅ Aceite: remoção do responsável → WAITING_REASSIGNMENT preservando prazo
- ✅ Aceite: alteração de prazo e cancelamento registrados em auditoria
- ✅ CI verde com migrations, typecheck, testes, build dos apps, imagens Docker e Helm lint


## Continuidade e recuperação

- ✅ Script de backup lógico PostgreSQL em formato custom
- ✅ Script de restore com verificação de schema
- ✅ Restore smoke test executado no CI e validado com sucesso
- ✅ Restore drill mensal automatizado + execução manual disponível
- ✅ Runbook de incidente, rollback e recuperação
- ✅ Estratégia de rollback por tags/SHA imutáveis sem rollback destrutivo de migration
- ✅ RPO/RTO documentados: 15 min / 4 h
- ✅ PITR configurado no Terraform do OCI PostgreSQL; ativação efetiva ocorre no terraform apply do ambiente


## Segurança de pipeline e cluster

- ✅ Dependabot semanal para npm, GitHub Actions e Dockerfiles
- ✅ CodeQL JavaScript/TypeScript em PR/main e agenda semanal
- ✅ Trivy filesystem para vulnerabilidades HIGH/CRITICAL com SARIF
- ✅ Security workflow validado com sucesso
- ✅ PodDisruptionBudget para API e frontend
- ✅ NetworkPolicy default-deny de entrada para pods do Handoff
- ✅ Entrada API/web limitada ao ingress controller no chart
- ✅ Containers non-root, root filesystem read-only e capabilities removidas
- ✅ Checklist de segurança documentado
- ✅ OCI WAF parametrizado no Terraform com rate limiting básico; ativação depende somente do Load Balancer/terraform apply do ambiente


## IaC OCI

- ✅ OCI WAF no Terraform, opcional e anexado a Load Balancer por OCID

- ✅ Provider OCI 8.29 parametrizado
- ✅ Home region provider para operações IAM do OKE
- ✅ Módulo oficial OKE 5.5.1
- ✅ Worker pools parametrizáveis
- ✅ Object Storage privado com versionamento
- ✅ OCI Vault + chave AES
- ✅ OCI Database with PostgreSQL
- ✅ PITR parametrizado para PostgreSQL
- ✅ Terraform fmt no CI
- ✅ Terraform init/validate no CI
- ✅ IaC validado com sucesso no pipeline
- 🟡 Terraform apply real depende de tenancy/compartment/subnet/credenciais OCI


## Prontidão de deploy e go-live

- ✅ Smoke test não destrutivo para API e frontend
- ✅ Smoke test valida health, proteção de métricas e resolução de tenant
- ✅ Smoke autenticado opcional valida login e leitura da inbox
- ✅ Workflow manual/agendado para smoke de staging
- ✅ Checklist de go-live/corte/rollback documentado
- ✅ Scripts shell operacionais validados no CI
- 🟡 Execução real do smoke/DAST depende das URLs e credenciais do ambiente de staging
- 🟡 DNS/TLS/Vault/OKE/PostgreSQL/Object Storage/WAF precisam ser aplicados e confirmados no ambiente real


## API pública e webhooks

- ✅ API key por tenant com token exibido uma única vez e SHA-256 no banco
- ✅ Escopo inicial `requests:read`
- ✅ Revogação, expiração e last-used de API keys
- ✅ REST pública para listar e consultar solicitações
- ✅ Gestão de webhooks pelo Admin da Empresa
- ✅ Segredo de webhook cifrado AES-256-GCM
- ✅ Eventos `request.approved` e `request.overdue`
- ✅ Outbox idempotente e retry com backoff
- ✅ Assinatura HMAC-SHA256 com event id/timestamp
- ✅ Bloqueio de URLs locais/privadas literais
- ✅ Testes de integração em PostgreSQL real
- ✅ Contrato documentado em `docs/api-publica.md`
- ✅ CI completo verde após implementação


## LGPD e retenção

- ✅ Retenção configurável por tenant, padrão 5 anos
- ✅ Relatório de solicitações elegíveis para revisão de retenção
- ✅ Sem exclusão destrutiva automática de histórico/evidências
- ✅ Pedidos de titular: acesso, correção, eliminação e restrição
- ✅ Estados de atendimento com bloqueio de reabertura após conclusão/rejeição
- ✅ Exportação consolidada e auditada dos dados do titular
- ✅ DPA com status, referência e data obrigatória quando assinado
- ✅ Registro de operações de tratamento (ROPA): finalidade, base legal, categorias, operadores e retenção
- ✅ Tela web de Compliance/LGPD
- ✅ Testes de integração em PostgreSQL real
- ✅ Documentação em `docs/lgpd-retencao.md`
- ✅ CI completo verde após implementação
