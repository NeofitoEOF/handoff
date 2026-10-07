# Análise crítica do MVP

03/10/2026 · avalia a primeira versão dos requisitos (antes da revisão em [MVP revisado](mvp-revisado.md))

## Veredito

**Atende parcialmente.** A dor existe e está bem documentada, mas o MVP como estava escrito resolvia um problema genérico ("trocar informação entre áreas") com um produto genérico, e nesse espaço o cliente já tem alternativas pagas ou até gratuitas dentro do Microsoft 365. O que é realmente diferente na proposta — upload de Excel validado contra um modelo, com prazo e aprovação por outra pessoa — era pequeno demais para justificar as 12 semanas e os 24 requisitos planejados.

Três problemas centrais:

1. **Sem comprador definido.** "Qualquer área" significa que ninguém tem orçamento nem urgência para comprar.
2. **O concorrente real é o Microsoft 365 que a empresa já paga**, não Pipefy ou Workiva.
3. **Escopo grande demais para validar uma hipótese ainda não validada.** Metade dos requisitos (cadeia de hash, construtor visual, cadastro self-service, multi-plano) era engenharia para um cliente que ainda não existe.

A recomendação é estreitar para **um fluxo de um setor**, provar com 3–5 empresas usando um protótipo barato e só então construir a plataforma multi-tenant.

## A demanda é real?

Sim, o problema de planilhas é real; não está provado que a empresa pague para resolver **especificamente a troca entre áreas**.

| Evidência | O que diz | Limite da evidência |
| --- | --- | --- |
| Auditorias de campo de planilhas reais (Panko) | Os estudos com metodologia mais recente acharam erros em pelo menos 86% das planilhas auditadas ([arXiv](https://arxiv.org/pdf/0802.3457)) | Mede erro de fórmula e modelagem, não erro na troca entre áreas |
| Revisão de 35 anos de estudos (Poon et al., 2024) | 94% das planilhas de negócio contêm erros ([Newswise](https://www.newswise.com/articles/study-finds-94-of-business-spreadsheets-have-critical-errors)) | É revisão de literatura, e o número vem de poucos estudos citados ([Slashdot](https://tech.slashdot.org/story/24/08/13/2335207)) |
| Budget Trends (Treasy), controladoria no Brasil | 54% das empresas usam Excel ou Google Sheets, só 9% têm sistema especialista, 41% citam dependência de planilhas como obstáculo ([Treasy](https://treasy.com.br/?p=50351)) | Pesquisa de um fornecedor de software; trata de planejamento, não de troca entre áreas |
| Gestão de despesas em PMEs brasileiras (Conta Simples e Visa, 2025) | Planilhas são o recurso mais usado, por 65% das empresas ([Let's Money](https://www.letsmoney.com.br/noticias/elo-microsoft-pagamento-ia-excel/)) | Foco em micro e pequenas, fora do público-alvo |

**Leitura crítica:** os números mais citados falam de erro **dentro** da planilha (fórmula, digitação). O MVP não resolve fórmula, resolve o **handoff** — e para o handoff não encontrei nenhum dado quantitativo. Essa é a hipótese que precisa de validação primária, não de pesquisa de mesa.

## Concorrência que o MVP subestimou

O documento de requisitos comparava o produto com Workiva e Pipefy, mas o concorrente que decide a venda é o **Microsoft 365**: quem já paga a licença tem formulário, lista, aprovação e trilha sem custo adicional.

| Alternativa | Como cobre o fluxo pedido → preenchimento → aprovação | Custo para o cliente | Onde perde para a proposta |
| --- | --- | --- | --- |
| Microsoft Forms + Lists + Power Automate | Lists coleta dados como no Excel, Power Automate monta alertas e aprovações ([Microsoft/SharePoint](https://www.coollink.ng/product-and-services/microsoft-365/microsoft-sharepoint/)); conectores padrão já incluídos no Business Basic, Standard e Premium ([Citizen Development Academy](https://citizendevelopmentacademy.com/power-automate-pricing/)) | Já pago: Business Basic sobe para US$ 7/usuário/mês a partir de jul/2026 ([Baguete](https://www.baguete.com.br/noticias/microsoft-sobe-precos-em-2026)) | Exige alguém para montar e manter cada fluxo; sem upload de .xlsx validado linha a linha; sem fechamento congelado |
| Copilot no Excel (modo agente) | Disponível por padrão para licenças Copilot desde 22/04/2026 ([Sagnik Bhattacharya](https://sagnikbhattacharya.com/blog/copilot-agentic-ga-2026)) | Complemento de US$ 30/usuário/mês ([Braintree](https://www.braintree.co.za/microsoft-365-copilot-agent-mode-rollout/)) | Ajuda a montar e limpar planilha, não controla o pedido entre áreas — mas reduz a dor de "planilha errada" |
| Pipefy (BR) | Formulários públicos para quem não é membro do processo e portal com formulários por departamento ([Pipefy](https://help.pipefy.com/en/articles/4173939-how-to-share-public-forms)) | Starter gratuito, Business US$ 18 e Enterprise US$ 30 por usuário/mês ([GetApp](https://www.getapp.pt/software/107957/pipefy)) | Revisores citam custo alto de transações de API ([Secret](https://www.joinsecret.com/pt/pipefy)) |
| Zeev (BR) | Usuários relatam usar para centralizar solicitações e rastrear processos entre áreas ([B2B Stack](https://www.b2bstack.com.br/product/zeev/avaliacoes)) | Sob consulta | Reclamações sobre limites em validações e tabelas nos formulários — exatamente o ponto forte da proposta |
| Smartsheet | Formulários alimentando grade, com aprovações e comentários documentando a revisão ([ZipDo](https://zipdo.co/best/field-audit-software/)) | Licença por usuário (não verificado) | Usuário relata falta de histórico de versão dos formulários ([AWS Marketplace](https://aws.amazon.com/marketplace/reviews/reviews-list/prodview-lmxunqckv74qy?page=984)) |
| FloQast | Mantém o contador no Excel e adiciona checklist, evidência e aprovação por cima ([UsagePricing](https://usagepricing.com/blueprint/stack/floqast)) | Mais barato que BlackLine, mas focado no mercado norte-americano | Só cobre o fechamento contábil |

**O aprendizado mais útil é o do FloQast:** ele venceu no mid-market não por substituir o Excel, mas por manter os papéis de trabalho em Excel e cobrir só um fluxo (o fechamento). É o mesmo princípio da proposta, aplicado a um único setor com comprador claro (o controller).

## Pontos fracos do MVP proposto

Cada item abaixo aponta uma decisão da primeira versão dos requisitos que, sem validação, aumentava custo ou risco mais do que valor.

| Item do MVP | Problema | Gravidade |
| --- | --- | --- |
| Público "qualquer setor" | Produto horizontal só é tão bom quanto seu melhor caso vertical, e cada caso compete com uma ferramenta feita sob medida ([Lenny's Newsletter](https://www.lennysnewsletter.com/p/lessons-learned-from-a-startup-that)) | Alta |
| Preenchedor precisa ter conta e logar | Quem preenche é de outra área e não pediu a ferramenta; Pipefy já aceita preenchimento sem ser membro. Login obrigatório mata a adoção do lado que mais importa | Alta |
| Não integra com ERP | O dado que a área devolve quase sempre sai do ERP para o Excel. O MVP só troca o lugar da digitação; o erro de cópia continua | Alta |
| Construtor visual de modelos | É um produto inteiro por si só (Zeev e Pipefy investiram anos nisso) e exige que o cliente modele o próprio processo, que é exatamente o trabalho que ele não quer fazer | Média |
| Cadeia de hash e ancoragem WORM | Nenhum auditor citado na pesquisa exige prova criptográfica; trilha append-only com controle de acesso já atende. É sofisticação que não vende no primeiro cliente | Média |
| Cadastro self-service com CNPJ | Venda para média empresa no Brasil é consultiva; self-service só ajuda depois que existe um caso de uso que se explica sozinho | Média |
| Preço por usuário | Penaliza justamente o preenchedor ocasional, que deveria ser gratuito para não travar a adoção | Média |
| Sem fórmulas | Muitas trocas envolvem cálculo (rateio, provisão). Se a área continuar calculando no Excel e só colar o resultado, o valor de auditoria cai | Média |
| 24 requisitos em 12 semanas com 1–2 devs | Multi-tenant com RLS, grade tipo planilha, importação assíncrona, PDF, notificações e auditoria é estimativa otimista; atraso empurra a validação para 2027 | Alta |
| Sem estratégia para IA | Copilot já edita planilhas em modo agente; um LLM também consegue ler o Excel "bagunçado" que a área já tem e mapear para o modelo. Forçar template rígido pode ser o caminho mais lento | Média |

**O que se sustenta:** solicitação com prazo e responsável, upload de .xlsx validado contra um modelo, revisão por outra pessoa e registro congelado do que foi aprovado. Esse núcleo é coerente e é o que os concorrentes fazem mal (Zeev em validação de tabelas, M365 em importação de planilha).

## Riscos de adoção e de venda

O maior risco não é técnico: é o produto funcionar e ninguém mudar o hábito de mandar e-mail com anexo.

- **"Já temos o Microsoft 365, o TI monta isso no Power Automate."** Vai ser a primeira objeção em quase toda venda. A resposta precisa ser concreta (tempo de montagem, manutenção, importação validada), senão o TI vence por custo zero aparente.
- **Adoção assimétrica.** Quem pede ganha controle; quem preenche ganha trabalho. Se o preenchedor achar mais fácil responder o e-mail, o sistema fica vazio e o comprador cancela em 3–6 meses.
- **Comprador indefinido.** TI vê como mais uma ferramenta; cada área vê como problema de outra. Sem um dono com orçamento (controller, gerente fiscal), o ciclo de venda fica longo e trava.
- **Concorrência local de baixo preço.** Pipefy tem plano gratuito e Zeev é escolhido por custo-benefício contra o Pipefy ([Capterra](https://www.capterra.com/p/10024428/Zeev/reviews/)); competir em preço horizontal é perder.
- **Tendência de mercado.** Horizontais crescem mais devagar que verticais e são mais fáceis de cortar quando o orçamento aperta ([SaaStr](https://www.saastr.com/why-saas-companies-that-sell-outside-of-tech-are-on-fire)). É opinião de mercado, mas coerente com o caso FloQast.
- **Tempo de fundador.** Com 1–2 pessoas em tempo parcial, 12 semanas de construção antes de qualquer validação é o cenário em que a ideia morre sem ter sido testada.

## O que mudar no MVP

Troque "plataforma para qualquer área" por **um fluxo recorrente de um setor, com um comprador que tem orçamento**, e corte o MVP para algo que rode em 4–6 semanas.

**Escolha do fluxo inicial** (decidir pelas entrevistas, não por preferência):

| Fluxo candidato | Comprador | Frequência | A favor | Contra |
| --- | --- | --- | --- | --- |
| Controladoria coletando provisões e informações das áreas para o fechamento mensal | Controller | Mensal, todo mês | Prazo fixo, auditor externo olha, modelo do FloQast já validou a dor | Concorre com ERP e ferramentas de fechamento no futuro |
| Fiscal coletando justificativas de divergências (CFOP, NCM, CBS/IBS) junto a Compras e Logística | Gerente fiscal | Mensal + picos na transição da Reforma | Urgência regulatória, risco de autuação, conecta com a ideia de conciliação de exceções | Exige conhecimento fiscal profundo nos modelos |

**Manter, cortar e adicionar**

| Item | Decisão | Motivo |
| --- | --- | --- |
| Solicitação com prazo, responsável e status | Manter | É o núcleo |
| Upload .xlsx validado linha a linha + formulário | Manter | É o diferencial real |
| Aprovação por outra pessoa e registro congelado | Manter | É o que o auditor pede |
| `tenant_id` + RLS no Postgres | Manter | Custo baixo agora, caro de adicionar depois |
| Construtor visual de modelos | Cortar | Você cria os modelos do fluxo escolhido; construtor só depois de 10 clientes |
| Cadeia de hash e WORM | Adiar | Log append-only basta até um cliente pedir |
| Cadastro self-service, planos e cobrança | Cortar | Contrato manual com os pilotos |
| Grade estilo planilha | Adiar | Upload + formulário cobrem o piloto; grade é a parte mais cara do front |
| Preenchimento sem conta (link com código por e-mail) | Adicionar | Remove o maior atrito de adoção |
| Login Microsoft (Entra ID) e aviso no Teams/Outlook | Adicionar | O cliente vive no M365; virar "parte do 365" neutraliza a objeção do Power Automate |
| Mapeamento assistido por IA do Excel livre para o modelo | Adicionar (P1) | Aceita a planilha que a área já tem, sem exigir template |
| Preço por fluxo ou área solicitante, preenchedor grátis | Adicionar | Alinha preço com quem ganha valor |

**Antes de escrever código:** rode 4 semanas de piloto "concierge" com 2–3 empresas usando o que já existe (Forms + Lists + um script para validar o .xlsx). Se nem com alguém operando à mão eles largarem o e-mail, a versão automatizada também não vai mudar o hábito.

## Perguntas para validar antes de codar

Cada pergunta derruba ou confirma uma hipótese do MVP; fazer com 5–10 controllers ou gerentes fiscais, pedindo para ver o processo real, não a opinião.

- [ ] Quantas solicitações de dados entre áreas você abre por mês, e quantas atrasam? (tamanho da dor)
- [ ] Me mostra a última planilha que voltou errada: o que deu errado e quanto tempo custou? (dor concreta, não hipotética)
- [ ] Algum auditor já pediu prova de quem enviou ou alterou esses dados? (valor real da auditoria)
- [ ] Vocês já tentaram resolver com Forms, Lists, Power Automate, Pipefy ou similar? Por que não ficou? (por que o substituto gratuito falhou)
- [ ] De onde vem o dado que a outra área preenche — ERP, outro Excel, cabeça? (necessidade de integração)
- [ ] Quem preenche aceitaria entrar num sistema, ou só responderia por link? (atrito de adoção)
- [ ] Quem aprovaria a compra, e de qual orçamento sairia? (comprador)
- [ ] Quanto vocês pagariam por mês para esse fluxo nunca mais atrasar nem voltar errado? (disposição a pagar)

**Critério de corte sugerido:** seguir para construção só se pelo menos 3 empresas confirmarem dor recorrente, mostrarem uma tentativa anterior que falhou e aceitarem um piloto pago (mesmo simbólico).

## Pesquisa adicional — falhas operacionais observadas em ferramentas de workflow

Uma busca complementar em avaliações de usuários e documentação oficial reforça que o risco operacional não termina quando o processo sai do e-mail. Os problemas mudam de forma: permissões difíceis de manter, aprovações órfãs, convidados com atrito, fluxos que expiram e regras complexas demais para o usuário configurar.

| Evidência observada | Implicação para o Handoff |
| --- | --- |
| Avaliação verificada do Pipefy relata permissões ficando confusas entre departamentos; outras avaliações destacam esforço inicial para configurar workflows complexos ([Capterra, 2026](https://www.capterra.com/p/144848/Pipefy/reviews/)) | Não espalhar regra de acesso em configurações livres: autoridade de origem/destino e maker-checker devem ser regras centrais do produto |
| Usuários do Smartsheet relatam onboarding relevante e um caso em que resposta de stakeholder externo volta ao proprietário da planilha, não necessariamente a quem opera aquele relacionamento ([G2](https://www.g2.com/products/smartsheet/reviews)) | Responsável operacional deve ser explícito e reatribuível; mensagens e respostas não podem depender de um “owner” técnico do artefato |
| A Microsoft documenta aprovações abandonadas quando a espera excede 28 dias e recomenda timeout explícito; fluxos em nuvem têm duração máxima e precisam persistir estado em processos longos ([Known issues](https://learn.microsoft.com/en-us/power-automate/approvals-known-issues), [error reference](https://learn.microsoft.com/power-automate/error-reference)) | Solicitação não pode depender de uma execução longa em memória. O estado precisa ser persistente, com vencimento, atraso e escalonamento como estados de negócio |
| A Microsoft também documenta limitações para convidados em aprovações, inclusive necessidade de licença em determinados cenários ([Known issues](https://learn.microsoft.com/en-us/power-automate/approvals-known-issues)) | O convidado do Handoff deve ser participação limitada à solicitação, sem exigir licença ou membership do tenant; a empresa decide se permite terceiro externo |
| Power Automate trata explicitamente reatribuição, cancelamento, aprovações sequenciais e aprovação por grupos como cenários comuns ([Approval scenarios](https://learn.microsoft.com/pt-br/power-automate/approvals-howto)) | Reatribuir, cancelar com histórico, substituir aprovador e evitar bloqueio por ausência não são edge cases; precisam nascer como regras |
| Avaliações recentes do Zeev elogiam centralização/rastreabilidade, mas citam limitações em personalizações avançadas, validações e tabelas ([B2B Stack, 2026](https://www.b2bstack.com.br/product/zeev)) | O diferencial do Handoff deve continuar estreito: validação forte de dados tabulares e regras operacionais prontas, em vez de tentar virar um BPM genérico configurável |

**Conclusão operacional:** o produto não deve competir por “ter mais automações”. A vantagem pode ser oferecer um fluxo opinativo que já saiba lidar com os casos que quebram operações reais: reatribuição sem perda de histórico, prazo do setor, devolução com novo prazo, aprovação por item, retificação sem reabrir fechamento, cancelamento auditado e coleta multi-setor.

Essas conclusões foram incorporadas ao [MVP revisado](mvp-revisado.md) e às **Regras operacionais do fluxo** em [Requisitos técnicos](requisitos-tecnicos.md).

## Fontes

A maior parte vem de resultados de busca e páginas de avaliação; dados de fornecedores (Treasy, comparativos de concorrentes) têm viés comercial. A página da pesquisa Treasy redirecionou para a home ao ser aberta, então os números dela vêm do trecho indexado.

- [Panko — Spreadsheet Errors: What We Know (arXiv)](https://arxiv.org/pdf/0802.3457)
- [Newswise — 94% das planilhas de negócio têm erros (Poon et al.)](https://www.newswise.com/articles/study-finds-94-of-business-spreadsheets-have-critical-errors)
- [Slashdot — crítica à metodologia do estudo dos 94%](https://tech.slashdot.org/story/24/08/13/2335207)
- [Treasy — Budget Trends](https://treasy.com.br/?p=50351)
- [Let's Money — Panorama de Gestão de Despesas (Conta Simples e Visa)](https://www.letsmoney.com.br/noticias/elo-microsoft-pagamento-ia-excel/)
- [Microsoft SharePoint, Lists e Power Automate (revenda)](https://www.coollink.ng/product-and-services/microsoft-365/microsoft-sharepoint/)
- [Citizen Development Academy — Power Automate incluído no M365](https://citizendevelopmentacademy.com/power-automate-pricing/)
- [Baguete — reajuste do Microsoft 365 em jul/2026](https://www.baguete.com.br/noticias/microsoft-sobe-precos-em-2026)
- [Sagnik Bhattacharya — Copilot agêntico GA em abr/2026](https://sagnikbhattacharya.com/blog/copilot-agentic-ga-2026)
- [Braintree — preço e rollout do Copilot](https://www.braintree.co.za/microsoft-365-copilot-agent-mode-rollout/)
- [Pipefy — formulários públicos](https://help.pipefy.com/en/articles/4173939-how-to-share-public-forms)
- [GetApp — preços do Pipefy](https://www.getapp.pt/software/107957/pipefy)
- [Secret — avaliação do Pipefy](https://www.joinsecret.com/pt/pipefy)
- [B2B Stack — avaliações do Zeev](https://www.b2bstack.com.br/product/zeev/avaliacoes)
- [Capterra — avaliações do Zeev](https://www.capterra.com/p/10024428/Zeev/reviews/)
- [ZipDo — Smartsheet em auditoria](https://zipdo.co/best/field-audit-software/)
- [AWS Marketplace — avaliações do Smartsheet](https://aws.amazon.com/marketplace/reviews/reviews-list/prodview-lmxunqckv74qy?page=984)
- [UsagePricing — FloQast](https://usagepricing.com/blueprint/stack/floqast)
- [Lenny's Newsletter — lições de uma startup horizontal que fechou](https://www.lennysnewsletter.com/p/lessons-learned-from-a-startup-that)
- [SaaStr — vertical vs. horizontal](https://www.saastr.com/why-saas-companies-that-sell-outside-of-tech-are-on-fire)
- [Pipefy — avaliações Capterra 2026](https://www.capterra.com/p/144848/Pipefy/reviews/)
- [Smartsheet — avaliações G2](https://www.g2.com/products/smartsheet/reviews)
- [Microsoft Learn — known issues de Approvals](https://learn.microsoft.com/en-us/power-automate/approvals-known-issues)
- [Microsoft Learn — cenários comuns de aprovação](https://learn.microsoft.com/pt-br/power-automate/approvals-howto)
- [Microsoft Learn — timeouts e erros de flows](https://learn.microsoft.com/power-automate/error-reference)
