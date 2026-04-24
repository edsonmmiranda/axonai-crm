# PRD — Área Administrativa do SaaS (Axon AI CRM)

> **Status:** Draft para planejamento.
> **Owner:** Edson Miranda.
> **Data:** 2026-04-24.
> **Tipo:** Product Requirements Document (PRD) — descreve **o quê** e **por quê**. Decisões de arquitetura, schema, stack e roadmap ficam para o documento de planejamento que consome este PRD como entrada.

---

## 1. Visão geral

Construir a **Área Administrativa** do Axon AI CRM — o dashboard usado pelos **donos do SaaS** (equipe Axon AI) para operar o próprio negócio: cadastrar e gerenciar empresas-clientes, definir planos comerciais, controlar assinaturas, apoiar o time de suporte e administrar a própria plataforma.

A área é **separada do app customer existente** (o CRM que as empresas-clientes usam no dia a dia). Hoje esse dashboard não existe — toda operação de "back office" da Axon é feita manualmente no banco ou via ferramentas externas.

---

## 2. Problema

O Axon AI CRM é um SaaS multi-tenant em operação: empresas-clientes (organizations) usam a aplicação para gerenciar seus leads, produtos e pipelines. A equipe Axon precisa, mas **não tem hoje**, uma interface própria para:

- Cadastrar uma nova empresa-cliente sem SQL manual.
- Ver a lista de clientes ativos, suspensos, em trial, e filtrar por plano/estado.
- Alterar o plano de um cliente, estender trial, cancelar/reativar assinatura.
- Apoiar o cliente via visualização dos dados dele (sem modificar) para diagnóstico.
- Controlar quem, dentro da Axon, tem poder de super administrador.
- Auditar quem fez o quê, quando e em qual cliente.
- Configurar parâmetros de plataforma (feature flags, limites de trial, credenciais de integrações externas, políticas legais).
- Ver em um lugar só métricas vitais do negócio (número de clientes ativos, usuários totais, volume operacional).

A ausência dessa área força a equipe a executar tarefas críticas manualmente no banco — lento, sujeito a erro, sem rastro auditável, e bloqueador para escalar a operação além de um punhado de clientes.

---

## 3. Personas

### 3.1. Super Admin (owner)
- Edson e sócios.
- Acesso total: pode criar/remover outros platform admins, trocar planos, suspender orgs, editar configurações de plataforma, girar credenciais, ver audit log completo.
- Responsável por decisões comerciais e operacionais.

### 3.2. Admin de suporte
- Funcionário da Axon dedicado ao atendimento.
- Precisa visualizar dados de qualquer cliente para diagnóstico, **sem** poder modificar dados do cliente.
- Pode anotar/registrar interações (fase 2, fora do MVP).

### 3.3. Admin de billing (opcional no MVP)
- Funcionário focado em financeiro.
- Atua principalmente em assinaturas: estender trial, trocar plano, cancelar, reativar.
- No MVP o papel pode ser representado pelo Super Admin; separação formal vira relevante quando a equipe crescer.

### 3.4. Customer user (não é usuário desta área)
- Usuário das empresas-clientes.
- **Nunca** deve ter acesso — nem visual, nem via rede, nem via sessão compartilhada — a qualquer funcionalidade ou dado da Área Administrativa. Relacionado aqui apenas para reforçar o contorno.

---

## 4. Objetivos e métricas de sucesso

### 4.1. Objetivos do produto

1. **Autonomia operacional:** a equipe Axon deve conseguir operar 100% das tarefas abaixo sem acesso direto ao banco de produção:
   - Onboarding de um novo cliente (criar organization + plano + primeiro user).
   - Alterações de plano e assinatura.
   - Suspender/reativar cliente (ex: inadimplência, fraude, pedido do cliente).
   - Responder a solicitação de suporte precisando olhar dados do cliente.
   - Conceder/revogar poderes de administração dentro da Axon.
2. **Rastreabilidade:** toda ação sensível deve deixar rastro imutável e consultável — suficiente para auditoria interna, resposta a incidente ou requisição legal.
3. **Segurança não-negociável:** o blast radius de um comprometimento da área admin deve ser contido; o app customer e a área admin devem ter superfícies de ataque independentes.
4. **Performance não-pior-que-agora:** a existência da área admin não pode degradar a experiência do customer app.

### 4.2. Métricas de sucesso (pós-MVP)

| Métrica | Target |
|---|---|
| Onboarding de cliente (do "criar org" ao "cliente loga pela primeira vez") | ≤ 5 minutos, sem SQL manual |
| Tempo médio para admin identificar causa de um ticket de suporte | ≤ 3 minutos de navegação |
| % de ações sensíveis com rastro no audit log | 100% |
| Incidentes em que admin acidentalmente modifica dado do cliente achando que era read-only | 0 |
| Tempo de load do dashboard home com 1k organizations e 1M leads | < 1s |

---

## 5. Escopo

### 5.1. Dentro do MVP

1. **Autenticação e sessão admin** com segundo fator obrigatório.
2. **Dashboard home** — visão consolidada com indicadores-chave do negócio.
3. **Gestão de organizations (empresas-clientes)** — criar, listar, filtrar, detalhar, suspender, reativar.
4. **Suporte via inspeção read-only** — admin visualiza dados de um cliente (leads, usuários, produtos, pipelines, etc.) sem poder modificar.
5. **Gestão de planos comerciais** — CRUD de planos com nome, preço, limites e features inclusas.
6. **Gestão de assinaturas** — vincular plano à org, trocar plano, estender trial, cancelar, reativar, registrar status de pagamento manual.
7. **Gestão de platform admins** — convidar, listar, alterar papel, desativar.
8. **Audit log** — visualização de toda ação sensível (quem, quando, onde, qual mudança).
9. **Platform settings:**
   - Feature flags globais (toggles de funcionalidades experimentais).
   - Limites default de trial (duração, limites de uso).
   - Credenciais de integrações externas (armazenadas cifradas).
   - Políticas legais versionáveis (Termos, Privacidade, etc.) — referenciáveis pelo customer app.

### 5.2. Fora do MVP (fase 2+)

- **Impersonation** (admin "loga como" o cliente com sessão real). No MVP usamos apenas inspeção read-only. Impersonation real exige tratamento dedicado de LGPD, consentimento e auditoria bidirecional — vira projeto próprio.
- **Integração com gateway de pagamento** (cobrança automática, webhooks, invoices, métodos de pagamento). No MVP, cobrança é manual e o admin apenas registra status.
- **Dashboard financeiro avançado:** MRR, churn, LTV, cohort, previsão de receita.
- **Suporte integrado:** tickets, histórico de interações, integração com helpdesk externo.
- **Alertas automáticos** (ex: "org X passou de 90% do limite do plano").
- **Relatórios exportáveis** (CSV/PDF de métricas, assinaturas, audit).
- **RBAC granular** além dos três papéis (owner/support/billing). Papéis customizáveis por permissão ficam para quando o time crescer.

---

## 6. Requisitos funcionais

Cada requisito descreve **o quê** o produto deve permitir. A implementação (telas, APIs, schema) é decidida no planejamento.

### 6.1. Autenticação admin

- **RF-AUTH-1:** Admin deve autenticar com email + senha.
- **RF-AUTH-2:** Segundo fator (TOTP via authenticator app) é **obrigatório** para qualquer admin ativo. No primeiro login após criação/convite, o sistema força enrollment antes de liberar acesso.
- **RF-AUTH-3:** Sessão admin é **isolada** da sessão do app customer — logar em um não concede acesso ao outro, mesmo sendo a mesma pessoa.
- **RF-AUTH-4:** Tentativas de login devem ser limitadas (rate limit) para impedir brute force. Limites aceitáveis compartilhados com o customer app no MVP.
- **RF-AUTH-5:** Admin desativado deve ter sessão revogada imediatamente; tentativas futuras de login rejeitadas.
- **RF-AUTH-6:** Sessão admin expira em prazo mais curto que a do customer (valor a definir no planejamento, default sugerido: 8h de inatividade).
- **RF-AUTH-7:** Admin pode iniciar **reset de senha** pelo mesmo fluxo base do customer (magic link enviado por email). Ao completar o reset, o sistema força **re-enrollment de MFA** antes de liberar acesso — o próximo login exige configurar o segundo fator novamente. Backup codes não existem no MVP: admin sem acesso a email **e** MFA cai no procedimento de break-glass (RF-ADMIN-8).

### 6.2. Dashboard home

- **RF-DASH-1:** Exibir, em uma tela, indicadores-chave do SaaS. No MVP, três KPIs suficientes:
  - Número de organizations ativas (clientes).
  - Número de usuários ativos totais (todas as orgs clientes).
  - Volume agregado de uso (ex: leads totais ou métrica equivalente).
- **RF-DASH-2:** Indicadores devem excluir a organização interna da Axon (usada para dogfood) das contagens de clientes.
- **RF-DASH-3:** Indicadores devem carregar em tempo aceitável mesmo com muitos clientes e milhões de registros — leitura direta por `count(*)` em tabelas grandes **não** é aceitável.
- **RF-DASH-4:** Cada indicador deve exibir quando foi atualizado pela última vez (se houver cache) e permitir atualização manual pelo admin.

### 6.3. Organizations (empresas-clientes)

- **RF-ORG-1:** Listar organizations com paginação, ordenação e filtros por: status (ativa/suspensa), plano atual, estado da assinatura (trial/ativa/cancelada/atrasada), data de criação.
- **RF-ORG-2:** Busca textual por nome/slug/identificador.
- **RF-ORG-3:** Criar nova organization informando: nome, slug (auto-sugerido a partir do nome — lowercase, sem acentos, espaços viram hífen — ou editável pelo admin na criação), plano inicial e email do primeiro admin da org. O sistema envia convite ao primeiro admin (RF-SET-7 define como o envio acontece quando não há provedor de email configurado).
- **RF-ORG-4:** Ver detalhes de uma organization: metadados, plano atual, assinatura (status, período), número de usuários, data de criação, última atividade, histórico de eventos relevantes.
- **RF-ORG-5:** Suspender uma organization — impede login dos usuários daquela org e exibe mensagem apropriada ("sua conta foi suspensa, contate o suporte"), sem apagar dados.
- **RF-ORG-6:** Reativar uma organization suspensa.
- **RF-ORG-7:** A organização interna da Axon é **protegida** — não pode ser suspensa, cancelada ou excluída via UI admin.
- **RF-ORG-8:** Toda mudança de estado (criar, suspender, reativar) gera registro no audit log.
- **RF-ORG-9:** O slug da org obedece o formato `^[a-z0-9][a-z0-9-]{2,49}$`, é **único** na plataforma e **imutável a partir do primeiro login de qualquer usuário** daquela org. Antes do primeiro login registrado, admin pode editar o slug livremente; depois, só é alterável via procedimento manual fora da UI (runbook).

### 6.4. Suporte via inspeção read-only

- **RF-SUP-1:** A partir do detalhe de uma organization, o admin pode **inspecionar** os recursos daquela org em modo somente-leitura: leads, usuários, produtos, pipelines, categorias, tags e quaisquer outras entidades relevantes ao cliente.
- **RF-SUP-2:** A interface de inspeção **não** exibe botões, formulários ou atalhos que permitam modificar dado do cliente. Impossível mutar por engano.
- **RF-SUP-3:** Nenhuma sessão é criada em nome do cliente. Nenhum cookie é injetado. Nenhum token de acesso ao customer app é emitido.
- **RF-SUP-4:** Cada acesso à inspeção gera registro no audit log, incluindo admin responsável, organization inspecionada, recurso consultado e identificadores dos registros visualizados (para resposta a requisições LGPD).
- **RF-SUP-5:** Um banner persistente na UI deixa claro que o admin está vendo dados de um cliente específico, com o nome da org em destaque.

### 6.5. Planos

- **RF-PLAN-1:** CRUD de planos comerciais. Cada plano tem: nome, descrição, preço mensal, preço anual, features inclusas (lista textual descritiva para a UI do customer), flag público/oculto e um conjunto fechado de limites definidos em RF-PLAN-6.
- **RF-PLAN-2:** Planos podem ser marcados como "archived" — não aparecem como opção em novas assinaturas, mas orgs existentes continuam operando.
- **RF-PLAN-3:** Não é possível excluir um plano em uso por alguma assinatura ativa.
- **RF-PLAN-4:** Todo plano público visível ao customer app (para telas tipo "fazer upgrade") deve ser leitura controlada e cacheável.
- **RF-PLAN-5:** Alterações em plano geram audit log.
- **RF-PLAN-6:** Os limites de um plano no MVP são um **conjunto fechado, nomeado e tipado** de campos — cada um opcional (NULL significa "ilimitado" para aquele recurso naquele plano):
  - `max_users` (int) — número máximo de usuários ativos na org
  - `max_leads` (int)
  - `max_products` (int)
  - `max_pipelines` (int)
  - `max_active_integrations` (int)
  - `max_storage_mb` (int)
  - `allow_ai_features` (bool)
  
  Adicionar novo tipo de limite exige migration + deploy; não há edição de schema de limites em runtime. A UI admin lista os campos nominais ao criar/editar o plano.

### 6.6. Assinaturas

- **RF-SUB-1:** Cada organization tem no máximo uma assinatura ativa por vez.
- **RF-SUB-2:** Uma assinatura tem: plano atual, **status** (um dos valores definidos em RF-SUB-6), período (início/fim), metadata (anotações livres do admin + flags operacionais como `trial_days_override`).
- **RF-SUB-3:** Admin pode: atribuir plano à org (ao criar), trocar plano (upgrade/downgrade), estender duração de trial, cancelar, reativar, marcar como pagamento em atraso.
- **RF-SUB-4:** Troca de plano respeita regras configuráveis (ex: não permitir downgrade se os limites do novo plano forem menores que o uso atual da org). Regras exatas definidas no planejamento.
- **RF-SUB-5:** Toda mudança na assinatura gera audit log e, quando altera o acesso da org, aplica imediatamente a transição de status definida em RF-SUB-6.
- **RF-SUB-6:** **Tabela canônica de comportamento por status** — governa o acesso dos customer users daquela org:

  | Status | Acesso do customer | Gatilho |
  |---|---|---|
  | `trial` | Acesso completo | Criação da org (RF-SUB-7) |
  | `ativa` | Acesso completo | Plano pago ativo |
  | `past_due` | Acesso durante N dias de grace, depois bloqueado | Grace period configurável em Platform Settings (default 7 dias) |
  | `trial_expired` | Bloqueado | Trial terminou sem conversão |
  | `cancelada` | Acesso até o fim do período pago corrente, depois bloqueado | Ação admin ou pedido do cliente |
  | `suspensa` | Bloqueado imediatamente, independente de status financeiro | Ação admin (fraude, abuso, pedido legal) |

  Quando o acesso é bloqueado, customer users daquela org veem uma tela explicativa específica do status (ex: "seu trial terminou, contate o suporte") — não 401/403 genérico. Admin pode reverter qualquer estado de bloqueio com a ação apropriada (reativar, estender trial, trocar plano, etc.).
- **RF-SUB-7:** **Mecânica de trial.** Trial **inicia na criação da org**, não no primeiro login. Duração default vem de Platform Settings (RF-SET-3); override por org fica em `subscription.metadata.trial_days_override`. Ao fim do período, a transição para `trial_expired` acontece automaticamente (o "como" — job agendado vs. verificação lazy — é decidido no planejamento). Admin pode **estender** o trial somando dias ao período corrente quantas vezes forem necessárias; **não** é permitido reiniciar um trial em org que já teve um (INV-8). Toda extensão registra audit. Se a org converter para plano pago, o trial é encerrado e a assinatura vai para `ativa`.

### 6.7. Platform admins

- **RF-ADMIN-1:** CRUD de platform admins (membros da equipe Axon com poder administrativo).
- **RF-ADMIN-2:** Cada admin tem um papel: **owner**, **support** ou **billing**. Owner tem acesso total; support pode inspecionar e atuar em clientes; billing atua sobre planos/assinaturas. Matriz exata de permissões definida no planejamento.
- **RF-ADMIN-3:** Apenas admin com papel **owner** pode convidar novo admin, alterar papel de outro admin, ou desativar admin.
- **RF-ADMIN-4:** Convite é feito por email; o convidado cria sua conta via fluxo controlado e é obrigado a enrolar MFA antes do primeiro acesso efetivo.
- **RF-ADMIN-5:** Admin desativado perde acesso imediatamente; registro permanece para fins de audit (soft delete, não hard delete).
- **RF-ADMIN-6:** Deve ser **impossível** a última conta owner ativa se desativar (previne lockout).
- **RF-ADMIN-7:** Toda operação de CRUD de admin gera audit log.
- **RF-ADMIN-8:** **Procedimento de break-glass.** Recuperação de emergência para casos de lockout total (ex: último owner desativado, todos os admins perderam MFA). Implementado como **script CLI versionado** no repositório, executável apenas a partir de um ambiente com acesso ao banco de produção. Requer **simultaneamente**:
  1. credencial `SUPABASE_SERVICE_ROLE_KEY` do banco;
  2. segundo segredo dedicado `BREAK_GLASS_SECRET` (env rotacionável, guardado em cofre separado da service role);
  3. email do profile alvo como argumento.
  
  A execução: garante que o profile indicado tenha entrada ativa em `platform_admins` com papel `owner`, reseta o enrollment de MFA (obrigando re-enroll no próximo login), e grava linha de audit com `action='break_glass.recover_owner'` + metadata identificando operador do CLI. Procedimento detalhado vive em runbook operacional separado (fora do PRD).

### 6.8. Audit log

- **RF-AUDIT-1:** Toda ação sensível (criação/suspensão de org, troca de plano, mudança de assinatura, CRUD de admin, alteração de platform setting, inspeção de dados de cliente, login admin bem-sucedido e login falho) gera uma entrada no audit log.
- **RF-AUDIT-2:** Entrada do audit log contém: timestamp, admin responsável (id + email snapshot), ação, entidade alvo (tipo + id + org id quando aplicável), diff da mudança (antes/depois, se aplicável), IP de origem (quando confiável), contexto (user agent).
- **RF-AUDIT-3:** Audit log é **append-only** — não pode ser editado nem excluído por nenhum caminho de UI. Alterar o audit log requer acesso direto ao banco e deixa seu próprio rastro nos logs de infraestrutura.
- **RF-AUDIT-4:** Registro do audit acontece na **mesma transação** da ação sensível. Se o registro falhar, a ação é revertida. Não é aceitável operação executada sem audit.
- **RF-AUDIT-5:** Interface de visualização com filtros (admin, ação, entidade, período) e paginação.
- **RF-AUDIT-6:** Audit log é retido indefinidamente no MVP. Política de retenção formal é responsabilidade de fase 2.

### 6.9. Platform settings

- **RF-SET-1:** **Feature flags globais** — lista de toggles nomeados com valor booleano (ou pequena string). Customer app e admin app leem o estado atual. Alteração em UI é imediata.
- **RF-SET-2:** Feature flags têm schema validado — tentativa de criar flag com nome não conhecido pelo código é rejeitada (evita typo que vira silent failure).
- **RF-SET-3:** **Limites default de trial** — duração em dias, limites de uso durante trial. Aplicam-se a novas orgs salvo override no plano/assinatura.
- **RF-SET-4:** **Credenciais de integrações externas** — tokens/keys de serviços que a plataforma consome (ex: provedor de email, SMS). Armazenadas **cifradas em repouso**; UI mostra apenas metadados (nome, tipo, último uso), nunca o valor plaintext. Rotação suportada.
- **RF-SET-5:** **Políticas legais versionadas** — Termos de Uso, Política de Privacidade, e documentos assimilados. Cada versão fica guardada com data de vigência. Customer app referencia a versão vigente. Alterar a política é criar nova versão, não sobrescrever.
- **RF-SET-6:** Toda mudança de setting gera audit log.
- **RF-SET-7:** **Bootstrap de credenciais de email.** Credenciais para envio de convites e comunicação transacional podem vir de duas fontes, com precedência nessa ordem:
  1. **Platform Settings** (configurado pela UI admin, cifrado em repouso — RF-SET-4).
  2. **Variáveis de ambiente** (`BOOTSTRAP_EMAIL_*`) lidas no boot — **fallback apenas**.
  
  Se nenhuma das duas fontes estiver configurada, a UI admin exibe banner persistente "email não configurado" e qualquer fluxo que dependeria de email (convite de admin, convite de usuário customer, reset de senha, notificação) **gera um link copiável** ao invés de disparar envio — admin entrega o link manualmente (WhatsApp/Slack) até configurar email definitivo. Geração de link offline também gera audit.

### 6.10. Limites e enforcement

- **RF-LIMIT-1:** Os limites do plano vigente de cada org são **hard-enforced no backend**. Qualquer operação que faria a org exceder um limite (criar user, lead, produto, pipeline, ativar integração, consumir storage) é **rejeitada na mesma transação** do INSERT, retornando erro tipado. A UI customer traduz o erro em mensagem padrão tipo "seu plano permite até N {recurso}; faça upgrade ou contate o suporte".
- **RF-LIMIT-2:** Admin pode conceder **grant pontual** (override temporário de limite) a uma org específica sem alterar o plano comercial. Um grant tem: org alvo, campo de limite afetado, novo valor, motivo textual (obrigatório), data de expiração opcional. Grants ficam listados no detalhe da org (RF-ORG-4) e podem ser revogados a qualquer momento. Criação, edição, expiração e revogação de grant geram audit.
- **RF-LIMIT-3:** Um limite NULL no plano significa "ilimitado" para aquele recurso. Grant com expiração no passado é equivalente a grant revogado.
- **RF-LIMIT-4:** A verificação do limite ocorre **no backend** em todo caminho de criação/ativação de recurso — server action, RPC, API interna. Cache no cliente pode ser usado como sugestão de UX, **nunca** como barreira de segurança.

---

## 7. Requisitos não-funcionais

### 7.1. Segurança

- **RNF-SEC-1 — Isolamento de sessão:** sessão admin e sessão customer devem ser totalmente independentes. Comprometer uma sessão (ex: XSS no customer app) não deve conceder acesso à outra, mesmo para o mesmo usuário humano.
- **RNF-SEC-2 — Isolamento de superfície de rede:** a área admin deve ser servida em origem/domínio distinto do customer app. O planejamento escolhe o mecanismo exato (subdomínio, hostname separado, etc.), mas isolamento de cookie/origem é obrigatório.
- **RNF-SEC-3 — MFA obrigatório:** nenhum admin ativo pode operar sem segundo fator enrolado e verificado.
- **RNF-SEC-4 — Princípio do menor privilégio:** credenciais privilegiadas de banco usadas pela área admin não podem estar acessíveis a código do customer app. O planejamento define as barreiras técnicas (lint, convenção de nomes, code review, etc.).
- **RNF-SEC-5 — Auditabilidade transacional:** ver RF-AUDIT-4. Compliance depende de audit log completo.
- **RNF-SEC-6 — Cifragem em repouso:** credenciais e segredos sensíveis (RF-SET-4) ficam cifrados; a aplicação nunca armazena plaintext em tabelas próprias.
- **RNF-SEC-7 — Defesa contra RLS bypass:** tabelas globais da área admin devem ter RLS ativada em modo forçado — nem o owner da tabela consegue bypassar acidentalmente via migration futura.
- **RNF-SEC-8 — Rate limiting:** endpoints de login e operações sensíveis protegidos contra abuso.

### 7.2. Compliance / privacidade

- **RNF-PRIV-1 — LGPD:** toda visualização de dados de um cliente pelo admin deve ser rastreável. Se o cliente exercer direito de acesso ("quem viu meus dados?"), a resposta é extraível do audit log.
- **RNF-PRIV-2 — Sem ação em nome do cliente no MVP:** explicitamente descartada impersonation para evitar complicações de consentimento. Admin vê dados para diagnóstico, não age.
- **RNF-PRIV-3 — Retenção de dados sensíveis:** política de retenção aplicável ao audit log e credenciais cifradas fica documentada. Revisar antes de lançamento comercial.

### 7.3. Performance

- **RNF-PERF-1:** Dashboard home carrega em < 1s para a escala prevista (1k+ organizations, 1M+ leads agregados). Contagens exatas em tabelas grandes devem usar cache/estimativa aproximada.
- **RNF-PERF-2:** Listagens com filtro e paginação devem responder em < 500ms para datasets típicos.
- **RNF-PERF-3:** A existência e uso da área admin não pode degradar latência perceptível do customer app.

### 7.4. Disponibilidade

- **RNF-AVAIL-1:** Downtime da área admin não pode tirar o customer app do ar. Falhas devem ser contidas.
- **RNF-AVAIL-2:** Admin indisponível por minutos é aceitável no MVP (não é sistema crítico 24/7 para clientes).

### 7.5. Observabilidade

- **RNF-OBS-1:** Erros 5xx da área admin são logados com contexto (admin, ação tentada). Distintos dos erros do customer app para não poluir dashboards.
- **RNF-OBS-2:** Tentativas de login falho são observáveis em tempo quase-real para detecção de ataque.

### 7.6. Usabilidade

- **RNF-UX-1:** Visual e padrão de interação da área admin podem reusar o design system existente, mas o contexto admin é visualmente distinto (cor/branding) para que o operador nunca confunda o admin app com o customer app.
- **RNF-UX-2:** Ações destrutivas (suspender org, desativar admin, cancelar assinatura) exigem confirmação explícita com o nome da entidade alvo.
- **RNF-UX-3:** Todas as telas e mensagens em Português (pt-BR).

### 7.7. Catálogo de ameaças (threat model de produto)

Ameaças que a solução deve resistir. Cada uma cita a **defesa exigida** em termos de requisito já definido. Itens **não** são checklist de code review — são garantias de produto que o planejamento precisa cobrir.

- **T-01 — Session hijack cross-app.** Comprometer sessão do customer app (ex: XSS no CRM de um cliente) não pode conceder sessão admin, nem vice-versa, mesmo para o mesmo humano logado nos dois. *Defesa:* RNF-SEC-1, RNF-SEC-2.
- **T-02 — Credencial privilegiada no cliente.** Chaves de acesso privilegiado ao banco (bypass de RLS) nunca podem ser embarcadas em código entregue ao browser do customer, nem ficar acessíveis a caminho de código do customer app. *Defesa:* RNF-SEC-4; validação mecânica no CI obrigatória.
- **T-03 — Audit gap.** Ação sensível executada sem entrada correspondente no audit log — seja por fail-silent, seja por caminho que escapa do RPC auditável. Inaceitável para compliance. *Defesa:* RF-AUDIT-4, RNF-SEC-5, INV-6.
- **T-04 — Data leak cross-tenant.** Customer da org A consegue ler/escrever dado da org B (via query manipulada, token alterado, RLS quebrada, ou novo endpoint sem filtro). *Defesa:* RNF-SEC-7; isolamento por tenant é invariante do sistema todo, não só da admin area.
- **T-05 — UI ambígua entre contexto admin e customer.** Admin confunde área admin com customer app e executa ação no contexto errado (ex: cria lead no lugar de inspecionar). *Defesa:* RF-SUP-2, RF-SUP-5, RNF-UX-1, RNF-UX-2.
- **T-06 — RLS bypass por migration futura.** Developer cria migration que acidentalmente concede SELECT/UPDATE a role que não deveria ter, ou remove force-RLS. *Defesa:* RNF-SEC-7; política exige FORCE RLS em tabelas globais e revisão dedicada em toda migration que toque policies.
- **T-07 — Bruteforce de login admin.** Atacante itera senhas em endpoint de login admin. *Defesa:* RNF-SEC-8, RF-AUTH-4.
- **T-08 — Comprometimento de conta admin sem MFA.** Admin criado sem MFA, ou com MFA desativado, vira alvo de phishing/credential stuffing. *Defesa:* RF-AUTH-2, RF-AUTH-5, RNF-SEC-3; sistema não permite operar sem AAL2.
- **T-09 — Vazamento de credenciais de integração externa.** Tokens de serviços externos (email, SMS, gateway futuro) expostos em logs, UI, dumps de banco, ou bundle. *Defesa:* RF-SET-4, RNF-SEC-6, INV-7.
- **T-10 — XSS via dado do cliente na UI admin.** Admin inspeciona dados do cliente; payload malicioso salvo pelo cliente (ex: nome de lead com `<script>`) executa no contexto admin e exfiltra sessão privilegiada. *Defesa:* sanitização/escape obrigatório em toda renderização de dado de cliente na área admin; gate de teste G-09.
- **T-11 — CSRF em ação sensível.** Requisição cross-origin aciona mutation privilegiada (suspender org, cancelar assinatura) se admin estiver logado em outra aba. *Defesa:* Server Actions com proteção anti-CSRF nativa + origens separadas (RNF-SEC-2); planejamento valida o mecanismo.
- **T-12 — Audit log adulterado.** Entrada do audit log editada ou excluída para esconder ação — seja via UI, API, ou SQL de aplicação. *Defesa:* RF-AUDIT-3; audit é append-only em nível de banco (triggers), não só de aplicação.
- **T-13 — Race condition em mutation concorrente.** Dois admins editam a mesma assinatura/plano/org ao mesmo tempo; última escrita silenciosamente sobrescreve. *Defesa:* operações sensíveis usam locking otimista ou transação serializável; audit log registra ambas as tentativas.
- **T-14 — Lockout da plataforma.** Último owner ativo é desativado, ninguém consegue entrar na admin area sem acesso direto ao banco. *Defesa:* RF-ADMIN-6, INV-3.
- **T-15 — Downgrade de MFA por outro admin.** Admin A desativa MFA de admin B (ou reseta enrollment) e compromete B por phishing. *Defesa:* reset de MFA de outro admin exige step-up (ex: segundo owner confirma) + audit; planejamento define o mecanismo.
- **T-16 — Replay de convite admin.** Link de convite para novo platform admin usado mais de uma vez, ou após expiração, ou por destinatário diferente. *Defesa:* convite com nonce single-use + expiração curta + audit de consumo.
- **T-17 — LGPD — visualização sem rastro.** Admin visualiza dados pessoais de um cliente sem registro; cliente exerce direito de acesso e a Axon não consegue responder "quem viu meus dados". *Defesa:* RF-SUP-4, RNF-PRIV-1.
- **T-18 — Fuga em logs/telemetria.** Body de request com token/senha/dado sensível acaba em log de observabilidade, APM ou error tracker. *Defesa:* política de logging exclui campos sensíveis por nome; revisão dedicada antes de habilitar qualquer sink novo.
- **T-19 — DoS do customer via admin.** Query pesada disparada pela admin area (ex: métrica mal-indexada) degrada banco compartilhado e afeta customer app. *Defesa:* RNF-PERF-3; operações custosas usam cache ou processamento assíncrono.
- **T-20 — Abuso de break-glass.** Comprometimento apenas da service role não deve permitir escalação a owner; comprometimento apenas do `BREAK_GLASS_SECRET` idem. Se ambos forem comprometidos, ataque silencioso ganha poder máximo. *Defesa:* RF-ADMIN-8 (double-key); cada execução gera audit obrigatório e deve disparar alerta de observabilidade; segredos rotacionados em cadência distinta e guardados em cofres separados.
- **T-21 — Bypass de limite do plano.** Customer explora race, bug em RPC ou caminho de criação não coberto pelo check para criar recurso acima do limite — receita fantasma e contrato comercial violado. *Defesa:* RF-LIMIT-1 com verificação atômica no backend; gate G-19 exige teste em todo caminho de criação de recurso contável.

### 7.8. Gates de qualidade (garantias que os testes devem provar)

Categorias de teste automatizado **obrigatórias** em toda melhoria que toque o escopo correspondente. Descrevem a garantia de produto — o planejamento decide implementação (framework, fixtures, nível: unit/integration/e2e).

- **G-01 — MFA enforcement.** Qualquer mudança em auth admin mantém: admin sem AAL2 não acessa rota admin; admin com MFA revogado perde acesso no request seguinte. *Cobre:* RF-AUTH-2, RF-AUTH-5, T-08.
- **G-02 — Cross-tenant isolation.** Qualquer mudança em RLS, policies ou queries com `organization_id` mantém: sessão da org A não lê nem escreve dado da org B, mesmo com id válido na query. *Cobre:* RNF-SEC-7, T-04.
- **G-03 — Audit transacional.** Qualquer RPC/action sensível mantém: falha forçada no insert do audit faz rollback da mutation; nenhuma mutation listada em RF-AUDIT-1 persiste sem linha de audit correspondente. *Cobre:* RF-AUDIT-4, INV-6, T-03.
- **G-04 — Admin ↔ customer code isolation.** Build do customer app não importa módulos admin-only; build do admin não importa páginas customer-only. Verificado mecanicamente em CI. *Cobre:* RNF-SEC-4, T-02.
- **G-05 — Session isolation.** Login em um contexto (admin ou customer) não cria cookie/sessão válida no outro. Logout em um não afeta o outro. *Cobre:* RNF-SEC-1, T-01.
- **G-06 — Authorization por papel.** Cada papel admin (owner/support/billing) executa apenas as ações permitidas pela matriz; tentativas fora do papel são rejeitadas com 403 e geradas em audit. *Cobre:* RF-ADMIN-2, RF-ADMIN-3.
- **G-07 — Proteção da org interna.** RPCs destrutivas (suspender, cancelar, excluir) aplicadas à org interna da Axon são rejeitadas com erro tipado, independente do papel do admin. *Cobre:* RF-ORG-7, INV-4.
- **G-08 — Last-owner protection.** Tentativa de desativar o último owner ativo é rejeitada. *Cobre:* RF-ADMIN-6, INV-3, T-14.
- **G-09 — Output encoding na inspeção.** Renderização de dado do cliente na UI admin não executa script injetado; payloads conhecidos de XSS não disparam. *Cobre:* T-10.
- **G-10 — Audit append-only.** Nenhum caminho de UI/API expõe UPDATE ou DELETE em entradas de audit log. Tentativa via RPC é rejeitada. *Cobre:* RF-AUDIT-3, T-12.
- **G-11 — Plano em uso não exclui.** Tentativa de excluir plano com assinatura ativa é rejeitada com erro claro. *Cobre:* RF-PLAN-3, INV-2.
- **G-12 — Invariante de assinatura única.** Não é possível ter duas assinaturas simultaneamente ativas para a mesma org. *Cobre:* INV-1.
- **G-13 — Rate limit de login.** Tentativas de login excedendo o limite são bloqueadas e o evento é observável. *Cobre:* RF-AUTH-4, RNF-SEC-8, T-07.
- **G-14 — Credenciais nunca em plaintext na resposta.** Endpoints/actions que retornam settings de credenciais nunca incluem o valor plaintext — só metadados. *Cobre:* RF-SET-4, INV-7, T-09.
- **G-15 — Convite de admin single-use.** Consumir duas vezes o mesmo link de convite é rejeitado atomicamente. *Cobre:* T-16.
- **G-16 — Suíte de regressão de fluxos críticos.** Fluxos golden passam antes de qualquer merge na main: login customer, login admin com MFA, onboarding de cliente, suspensão de org, troca de plano, inspeção read-only, CRUD de admin. *Cobre:* integridade geral.
- **G-17 — Migrations reversíveis.** Toda migration estrutural tem script de rollback testado em ambiente de staging antes de chegar em prod. *Cobre:* operacional.
- **G-18 — Performance de listagens.** Queries de listagem (orgs, audit, etc.) com dataset representativo respondem dentro do SLA definido em RNF-PERF-2. Degradação detectável em CI.
- **G-19 — Enforcement de limites.** Toda mudança em rotas/RPCs que criam recurso contável (user, lead, produto, pipeline, integração, storage) mantém: operação que faria a org exceder o limite do plano é rejeitada na mesma transação; customer recebe erro tipado; nada persiste. *Cobre:* RF-LIMIT-1, RF-LIMIT-4, T-21.
- **G-20 — Slug imutável pós-login.** Tentativa de editar o slug de uma org que já teve pelo menos um login registrado é rejeitada com erro tipado. *Cobre:* RF-ORG-9, INV-9.
- **G-21 — Break-glass double-key e audit.** Execução do CLI de break-glass sem o segundo segredo é rejeitada; execução válida grava linha de audit obrigatoriamente com `action='break_glass.recover_owner'`. *Cobre:* RF-ADMIN-8, INV-10, T-20.
- **G-22 — MFA reset pós password-reset.** Após reset de senha admin bem-sucedido, o próximo login exige re-enrollment de MFA antes de liberar acesso à área admin. *Cobre:* RF-AUTH-7.
- **G-23 — Transições automáticas de status de assinatura.** Trial atinge fim do período → vira `trial_expired` sem intervenção manual. `past_due` excede grace → vira bloqueada. `cancelada` passa do fim do período pago → vira bloqueada. Gate valida que as transições ocorrem dentro do SLA definido no planejamento. *Cobre:* RF-SUB-6, RF-SUB-7.

---

## 8. Regras de negócio e invariantes

- **INV-1:** Toda organization cliente tem exatamente uma assinatura vigente (ativa, trial ou em atraso).
- **INV-2:** Um plano em uso por assinatura ativa não pode ser excluído.
- **INV-3:** Sempre existe pelo menos um platform admin **owner** ativo.
- **INV-4:** A organização interna da Axon existe sempre e não pode ser suspensa, cancelada ou removida pela UI.
- **INV-5:** Todo platform admin é um membro (profile) da organização interna da Axon. Admins não "pertencem" a orgs de clientes.
- **INV-6:** Toda ação listada em RF-AUDIT-1 gera linha em audit log, na mesma transação. Operação sem audit = bug.
- **INV-7:** Credenciais sensíveis (RF-SET-4) só são legíveis por código server-side explicitamente autorizado. UI nunca exibe plaintext.
- **INV-8:** Trial de uma org pode ser estendido por admin quantas vezes forem necessárias, mas **nunca reiniciado** após encerrado. Nova experiência de trial existe apenas para nova org.
- **INV-9:** O slug de uma org é **imutável a partir do primeiro login** de qualquer usuário daquela org. Antes disso, admin pode editar livremente.
- **INV-10:** Toda execução do procedimento de break-glass (RF-ADMIN-8) gera entrada no audit log. O segredo de break-glass é independente e rotacionado separadamente da service role do banco.

---

## 9. Restrições e premissas

### 9.1. Restrições

- **C-1:** Um único time de desenvolvimento (Edson + Claude Code). Escopo e prazos realistas.
- **C-2:** Mesma stack do customer app para maximizar reuso. Migrar de stack está fora de escopo.
- **C-3:** Mesmo banco de dados do customer app (multi-tenant já existente). Criar banco dedicado à admin fica descartado por custo operacional.
- **C-4:** Orçamento de infraestrutura segue o plano atual do provedor — não é aceitável dobrar custo para esta feature.
- **C-5:** Prazo alvo informal: MVP utilizável em semanas, não meses. O planejamento dimensiona sprints.

### 9.2. Premissas

- **A-1:** A quantidade de clientes no primeiro ano é pequena o suficiente (dezenas a baixas centenas) para que operações manuais de audit/suporte sejam viáveis.
- **A-2:** O time da Axon é pequeno (< 10 pessoas com acesso admin no MVP) — o modelo de 3 papéis é suficiente.
- **A-3:** Clientes aceitam que suporte veja seus dados para diagnóstico, desde que com rastro. Comunicação desse ponto nos termos de uso é responsabilidade legal/produto.
- **A-4:** Cobrança manual no MVP é aceitável comercialmente. Integração com gateway entra quando houver volume que justifique.

---

## 10. Decisões já tomadas (não rediscutir no planejamento)

Estas decisões **de produto** já estão fixadas. O planejamento pode escolher **como** implementá-las, mas **o quê** está decidido.

1. **Impersonation fica fora do MVP.** Substituída por inspeção read-only (RF-SUP).
2. **Billing automatizado fica fora do MVP.** Cobrança manual, status atualizado no admin.
3. **MFA obrigatório para admin.** Não há modo sem MFA no MVP.
4. **Audit transacional, não fail-silent.** Falha de audit = rollback da ação.
5. **Isolamento de origem entre admin e customer é requisito de segurança**, não escolha de UX.
6. **Três papéis no MVP:** owner, support, billing. RBAC fino fica para fase 2.
7. **Credenciais externas cifradas em repouso** — plaintext nunca vive em tabela da aplicação.
8. **Equipe Axon pode usar o customer app (dogfood)** com uma organização interna própria. Essa org é protegida contra operações destrutivas pela UI admin.
9. **Trial inicia na criação da org**, dura o default de Platform Settings, pode ser estendido quantas vezes necessário, nunca reiniciado.
10. **Limites do plano são hard-enforced no backend** — nada de soft-warn. Override pontual por org via "grant" auditável (RF-LIMIT-2) cobre exceções comerciais.
11. **Efeito de cancelamento/suspensão sobre acesso é tabelado em RF-SUB-6.** Nada mais é negociável por status.
12. **Schema de limites é conjunto fechado e tipado** (RF-PLAN-6), não JSONB livre. Adicionar novo limite exige migration + deploy.
13. **Slug da org é auto-sugerido, editável até o primeiro login, imutável depois** (RF-ORG-9).
14. **Email bootstrap suporta env var como fallback**; Platform Settings tem precedência; sem nenhum dos dois, convites viram link copiável offline (RF-SET-7).
15. **Break-glass existe como produto** — CLI versionado com double-key (service role + segredo dedicado), toda execução auditada (RF-ADMIN-8).
16. **Password reset admin força re-enrollment de MFA** no próximo login (RF-AUTH-7). Backup codes não existem no MVP.

---

## 11. Decisões em aberto (para o planejamento resolver)

1. **Fluxo exato de onboarding de cliente** — self-service (form público de signup que gera org automaticamente) vs. admin-gated (só a Axon cria orgs no MVP)? Default sugerido: admin-gated no MVP, self-service em fase 2.
2. **Matriz de permissões por papel** — detalhamento completo de quais ações cada papel (owner/support/billing) pode ou não fazer. PRD define papéis e decisões-chave (ex: só owner convida admin, RF-ADMIN-3); matriz fina vem do planejamento.
3. **Política de retenção de audit log** — manter indefinidamente ou truncar após N anos?
4. **Política de sessão admin** — duração exata, comportamento em múltiplas abas/dispositivos, logout forçado em mudança de papel.
5. **Branding da área admin** — nome visível, logo, paleta específica. Design task fora deste PRD.
6. **Mecanismo das transições automáticas de status** (RF-SUB-6, RF-SUB-7) — job agendado noturno, cron horário, verificação lazy a cada request, ou combinação? Decisão operacional.
7. **SLA de latência das transições automáticas** — quanto tempo entre "trial vence às 23:59" e "customer é bloqueado"? Minutos? Até 24h?

---

## 12. Riscos conhecidos

| Risco | Impacto | Mitigação sugerida |
|---|---|---|
| Vazamento de credenciais privilegiadas para o customer app | Alto (acesso cross-tenant) | Barreiras técnicas (lint, convenção, code review, CI check) definidas no planejamento |
| Admin confunde app admin com app customer e age no contexto errado | Médio | Branding visual distinto + banner de contexto + origens separadas |
| Inspeção read-only vira gargalo de suporte em casos complexos | Médio | Aceitável no MVP; se virar problema, reavaliar impersonation em fase 2 |
| Audit log fica grande demais e degrada performance de queries | Médio | Índices adequados + política de retenção definida antes de escalar |
| Mudança acidental em plano quebra clientes existentes | Alto | Confirmações explícitas + audit log + invariantes (INV-2) |
| Lockout de admins (ninguém consegue entrar) | Alto | INV-3 (last-owner protection) + procedimento formal de break-glass (RF-ADMIN-8) com double-key e audit |
| Receita fantasma por bypass de limite do plano | Médio | RF-LIMIT-1 hard-enforced no backend + G-19 cobrindo todo caminho de criação de recurso contável |
| Convite de admin/customer não chega por falha de email | Médio | Fallback de link copiável offline (RF-SET-7) evita bloqueio operacional |

---

## 13. Glossário

- **Organization / Org:** uma empresa-cliente do Axon AI CRM. Cada org é um tenant isolado.
- **Customer user:** usuário final (pessoa) que opera o CRM em nome de uma org cliente.
- **Platform admin / admin:** funcionário da Axon com acesso à área administrativa.
- **Super admin / owner:** platform admin com papel `owner` (poder total).
- **Área admin:** a aplicação descrita neste PRD (dashboard de operação do SaaS).
- **Customer app:** o CRM existente que as orgs clientes usam.
- **Org interna (AxonAI):** organization representando a própria Axon, usada como conta de dogfood e como "casa" dos platform admins.
- **Deep Inspect / inspeção read-only:** funcionalidade de visualização de dados do cliente sem poder de mutação.
- **Audit log:** registro append-only de ações sensíveis.
- **MFA AAL2:** nível de autenticação que inclui segundo fator (TOTP).
- **Ameaça (T-xx):** risco de segurança nomeado no catálogo §7.7 que a solução deve resistir.
- **Gate de qualidade (G-xx):** garantia que todo teste/CI deve provar antes de merge — definida em §7.8.
- **Slug:** identificador curto, URL-safe e único de uma org (RF-ORG-9).
- **Grant (limite pontual):** override temporário do limite de um plano para uma org específica, sem trocar o plano comercial (RF-LIMIT-2).
- **Break-glass:** procedimento de recuperação de emergência para lockout total da plataforma, via CLI com double-key (RF-ADMIN-8).
- **Trial / trial_expired / past_due / cancelada / suspensa:** valores de status de assinatura — comportamento tabelado em RF-SUB-6.

---

## 14. O que este PRD NÃO contém (intencionalmente)

- Arquitetura de software (como separar módulos, que framework, route group vs monorepo vs repo separado, subdomínio vs path prefix, middleware flow).
- Schema de banco (tabelas, colunas, tipos, chaves, policies).
- Stack técnica específica (Supabase X vs Y, Vault vs outra cifragem, qual lib de MFA).
- Quebra em sprints ou estimativa de prazo.
- Wireframes ou mockups detalhados (design task separada).
- Decisões de CI/CD, deployment, observability tooling.
- **Guia de security review em nível de código** (ex: "verificar flag `domain` do cookie", "rodar grep por nome da env var no bundle"). O PRD nomeia a **ameaça** em §7.7; a checklist técnica de revisão vive em `docs/conventions/security.md` ou em um threat-model operacional mantido pelo planejamento.
- **Implementação dos testes** (nomes de arquivo, framework específico, fixtures, estrutura de suite). O PRD nomeia o **gate** em §7.8 — qual garantia o teste deve provar. Como escrever e onde hospedar é definido pela estratégia de testes do planejamento.

Tudo isso é **responsabilidade do documento de planejamento** que consome este PRD como entrada.
