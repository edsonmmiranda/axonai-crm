# Plano de Sprints — Área Administrativa (Axon AI CRM)

> **Input:** [`admin_area_prd.md`](admin_area_prd.md)
> **Fonte do estado atual:** código-fonte em `src/` + banco de produção consultado via Supabase MCP (migrations e `schema_snapshot.json` explicitamente ignorados — PRD consome o real).
> **Data:** 2026-04-24
> **Tipo:** planejamento de execução — cada sprint deste plano será materializado como um sprint file em `sprints/active/` via `@sprint-creator`.

---

## 1. Decisões de produto assumidas (defaults aprovados)

Resolvem o §11 do PRD antes de o plano começar. Alterar um destes revisita o sprint correspondente.

| # | Decisão em aberto | Escolha |
|---|---|---|
| D-1 | Onboarding de cliente no MVP | **Admin-gated.** A rota pública `/signup` do customer app é **desativada** no Sprint 01 (mantida no código atrás de feature flag, nunca roteada). Self-service retorna em fase 2. |
| D-2 | Mecanismo de transição de status (RF-SUB-7) | **Lazy-check no middleware da área admin** + **pg_cron horário** que reavalia `trial`/`past_due`/`cancelada` e flipa `subscriptions.status` quando aplicável. Customer app lê `status` derivado. |
| D-3 | Origin isolation (RNF-SEC-2) | **Subdomínio dedicado** (`admin.<host>`). Host do customer app fica sem nenhuma rota `(admin)` servida. Configuração de deploy no Sprint 13. |
| D-4 | Branding admin | "**Axon Admin**", paleta **neutra escura** (variação do design system existente, cor de acento distinta). Tokens definidos no Sprint 04. |
| D-5 | Schema de role em `profiles` | **Normalizar código para o DB** — `'owner','admin','user','viewer'`. `getSessionContext` hoje converte para `member` (inconsistência). Fix incluso no Sprint 02. |

Decisões diferidas que **cada sprint deve resolver no seu escopo** (não bloqueiam o início):
- D-6 Matriz fina owner/support/billing → Sprint 02 (definir), 05/06/11 (exercitar)
- D-7 Política de retenção de audit log → Sprint 12 (decidir antes da UI ir pra prod)
- D-8 Duração da sessão admin → Sprint 04 (default sugerido: 8h inatividade, 12h absoluta)
- D-9 SLA exato de transição automática → Sprint 13 (default sugerido: até 15min)

---

## 2. Estado atual — o que existe e o que falta

**Reutilizável (não mexer além do estritamente necessário):**
- Multi-tenancy via `organization_id` + RLS com JWT claim (`custom_access_token_hook`)
- Auth: signup com confirmação email, anti-takeover (`signup_intents`), convites org-scoped (`invitations`), `auth.mfa_factors` disponível mas sem enforcement
- CRM operacional: leads, funnels/pipeline, products, categories, tags, lead_origins, loss_reasons, whatsapp_groups

**Gaps em relação ao PRD (materializáveis como sprints):**
- `organizations.plan` é `text CHECK` com valores hardcoded → PRD pede entidade `plans` + `subscriptions` com status
- `profiles.role` diverge entre DB (`owner/admin/user/viewer`) e `getSessionContext` (`owner/admin/member`) → bug técnico
- Inexistem: platform admins, audit log, grants, platform settings, feature flags, credenciais cifradas, políticas legais versionadas, rate limit, break-glass
- Inexiste org interna AxonAI (INV-4/INV-5)
- Inexiste route group `(admin)` — layout único em `src/app/(app)`
- Enforcement de limites cobre só usuários (`check_user_limit`) — leads/products/pipelines/integrations/storage estão sem gate

---

## 3. Sequenciamento e dependências

```
01 (plans+subs+org interna) ──┐
                              ├── 05 (CRUD orgs) ──── 08 (Deep Inspect)
02 (platform admins + RBAC) ──┤                   └── 09 (dashboard + settings base)
                              ├── 04 (shell admin)                 │
03 (audit log transacional) ──┘                                    │
                                                                   │
06 (plans CRUD + subscription lifecycle) ── 07 (limites + grants)  │
                                                                   │
10 (credenciais cifradas + email fallback) ──────────────── 11 (admins + reset MFA) ── 12 (audit UI + rate limit + break-glass)
                                                                                            │
13 (transições automáticas + slug imutável + origin isolation) ─────────────────────────────┘
```

**Caminho crítico para "admin operacional utilizável":** 01 → 02 → 03 → 04 → 05 → 06. Ao fim do Sprint 06 a equipe Axon já consegue onboarding, suspensão e troca de plano via UI sem SQL manual.

**Gates do PRD §7.8 distribuídos** (cada sprint abaixo lista os gates que precisa provar).

---

## 4. Sprints

### Sprint 01 — Foundation DB: planos, assinaturas e org interna Axon

**Nível:** STANDARD · **Modelo:** Opus / Opção 2 (score 11: novas tabelas `plans`+`subscriptions`+`internal_org` seed + backfill + RLS).

**Objetivo:** Substituir `organizations.plan` (text) pelo par `plans` + `subscriptions` com status canônico (RF-SUB-6), criar a organização interna AxonAI, e migrar as orgs existentes para o novo modelo sem quebrar o customer app.

**DB (autor: `@db-admin`):**
- `plans` — `id`, `name`, `description`, `price_monthly_cents`, `price_yearly_cents`, `features_jsonb` (descritivo para UI customer), `is_public bool`, `is_archived bool`, + **colunas tipadas de limite** (RF-PLAN-6): `max_users`, `max_leads`, `max_products`, `max_pipelines`, `max_active_integrations`, `max_storage_mb`, `allow_ai_features`. FORCE RLS.
- `subscriptions` — `id`, `organization_id` (FK), `plan_id` (FK), `status text CHECK IN ('trial','ativa','past_due','trial_expired','cancelada','suspensa')`, `period_start`, `period_end`, `metadata jsonb` (inclui `trial_days_override`). Partial unique index garantindo INV-1 (uma vigente por org: `WHERE status IN ('trial','ativa','past_due')`).
- Seed de 3 planos iniciais migrados de `free`/`basic`/`premium`, com os limites que hoje são implícitos (`organizations.max_users` vira base).
- Seed **org interna AxonAI** com `slug='axon'`, flag `is_internal boolean NOT NULL DEFAULT false` (nova coluna em `organizations`), subscription ativa em plano "internal" não-público.
- **Backfill:** cada organização existente recebe subscription ativa vinculada ao plano correspondente; coluna `organizations.plan` é mantida por 1 sprint com trigger que espelha leitura (compat) e depois removida no Sprint 05.
- RPC `get_current_subscription(org_id uuid) returns subscriptions` — leitura única usada pelo customer app.

**Código (autor: `@backend`):**
- Refatorar leituras de `organizations.plan` em `src/lib/actions/*.ts` e em `getSessionContext` para consultar `subscriptions`. Substituir por um helper `getOrgPlan(orgId)`.
- Desativar a rota pública `/signup` (D-1): remover `src/app/(auth)/signup/page.tsx` do roteamento (feature flag `enable_public_signup=false` hard-coded por ora; flag real vem no Sprint 09).

**Gates cobertos nesse sprint:** G-12 (invariante de subscription única, via partial unique index); G-17 (migration reversível — script de rollback testado).

**Riscos:** (1) backfill em produção sobre org com dados; (2) quebrar leitura de `plan` em caminhos não mapeados. **Mitigação:** trigger de espelhamento durante a janela de transição (Sprint 01 → Sprint 05).

**Critérios de aceite:**
- Toda org existente tem exatamente uma subscription com status `ativa` ou equivalente.
- Org interna AxonAI criada e marcada `is_internal=true`.
- Build + lint verde; customer app opera sem regressão (golden flows do CRM).
- `npm run build` e GATE 1 (RLS presente em `plans` e `subscriptions`).

---

### Sprint 02 — Platform admins, RBAC base e normalização de role

**Nível:** STANDARD · **Modelo:** Opus / Opção 2 (lógica de invariante last-owner + decisão de matriz de permissões).

**Objetivo:** Criar o modelo de platform admin (owner/support/billing) ancorado na org interna AxonAI (INV-5), garantir INV-3 (last-owner-protection) e resolver a inconsistência de role no código (D-5).

**DB (`@db-admin`):**
- `platform_admins` — `id`, `profile_id` (FK `profiles` — admin é um profile da org interna), `role text CHECK IN ('owner','support','billing')`, `is_active bool DEFAULT true`, `created_at`, `deactivated_at`. FORCE RLS.
- Trigger `prevent_last_owner_deactivation` em `platform_admins` — bloqueia UPDATE que deixaria zero owner ativo.
- RPC `is_platform_admin(profile_id uuid) returns platform_admins`.
- Seed manual do primeiro platform admin owner (Edson) — executado em janela de deploy, registrado em runbook.

**Código (`@backend`):**
- Helpers em `src/lib/auth/platformAdmin.ts`: `requirePlatformAdmin()`, `requirePlatformAdminRole(['owner'])`. **Não** usam JWT claim novo — consultam `platform_admins` server-side em cada request admin.
- Fix do `getSessionContext`: `SessionRole` passa a ser `'owner' | 'admin' | 'user' | 'viewer'` (D-5). Ajustar consumidores em `src/components/layout/AppLayout.tsx` e demais pontos (busca mecânica via grep em `role === 'member'`).
- Matriz de permissões (D-6) — documento `docs/admin_area/rbac_matrix.md` listando cada ação dos sprints 05+ por papel. Owner tem todos; support tem leitura + audit + inspeção; billing tem plans/subscriptions + leitura.

**Gates cobertos:** G-06 (authorization por papel — testada no primeiro exercício em Sprint 05); G-08 (last-owner — trigger + teste).

**Riscos:** divergência entre o role de tenant (`profiles.role`) e papel de plataforma (`platform_admins.role`). Devem ser **ortogonais** — documentar explicitamente.

**Critérios de aceite:**
- Edson logado é identificado como platform admin owner via `requirePlatformAdmin()`.
- Tentativa SQL direta de desativar o último owner é rejeitada pelo trigger.
- Código do customer app nunca importa `@/lib/auth/platformAdmin.ts` (verificado por grep no GATE 4).

---

### Sprint 03 — Audit log transacional (INV-6, T-03, T-12)

**Nível:** STANDARD · **Modelo:** Opus / Opção 2 (transacionalidade, append-only via policies FORCE + deny).

**Objetivo:** Infraestrutura de audit que garante que toda ação sensível dos sprints seguintes deixe rastro na mesma transação, sem caminho de UPDATE/DELETE via UI/RPC.

**DB (`@db-admin`):**
- `audit_log` — `id`, `occurred_at`, `actor_profile_id`, `actor_email_snapshot`, `action text` (ex: `'org.suspend'`, `'subscription.change_plan'`, `'inspect.read_leads'`), `target_type`, `target_id`, `target_organization_id` (nullable), `diff_before jsonb`, `diff_after jsonb`, `ip_address inet`, `user_agent text`, `metadata jsonb`. FORCE RLS.
- Policies: SELECT para platform admins conforme papel; **nenhuma policy de UPDATE/DELETE** (append-only em nível de banco — T-12, G-10).
- RPC `audit_write(action, target_type, target_id, target_organization_id, diff_before, diff_after, metadata)` `SECURITY DEFINER` — única via de inserção a partir do server-side; captura IP/UA de parâmetros que o caller envia.
- Trigger de deny em BEFORE UPDATE/DELETE (cinto + suspensório).

**Código (`@backend`):**
- Helper `src/lib/audit/write.ts` → wrapper de `audit_write` que recebe `ctx` (request) e extrai IP/UA de headers.
- **Contrato para todos os sprints seguintes:** qualquer Server Action sensível chama `writeAudit(...)` **dentro da mesma transação** da mutation. Documentado em `docs/conventions/audit.md`.

**Gates cobertos:** G-03 (transacional — teste que força falha do `audit_write` e valida rollback); G-10 (append-only — teste que tenta UPDATE/DELETE e recebe erro).

**Riscos:** pegar `ip_address` de forma confiável atrás de proxy/Vercel exige ler `x-forwarded-for` com cuidado. Tratar como `nullable` quando não confiável.

**Critérios de aceite:**
- Inserção em `audit_log` ok; UPDATE/DELETE em `audit_log` falham com erro tipado em qualquer role.
- Helper `writeAudit` exportado e documentado.

---

### Sprint 04 — Shell admin: route group `(admin)`, MFA AAL2, login isolado, branding

**Nível:** STANDARD · **Modelo:** Opus / Opção 2 (auth flow novo + isolamento de sessão).

**Objetivo:** Entregar a "casca" da área admin — admin entra, faz MFA, vê layout "Axon Admin", e qualquer rota sob `(admin)` rejeita quem não é platform admin ativo com AAL2.

**DB:** nenhuma tabela nova. Usa `auth.mfa_factors` existente.

**Código (`@frontend+` + `@backend`):**
- `src/app/(admin)/layout.tsx` — layout próprio (sidebar/topbar distintos do customer), tokens de tema "Axon Admin" (D-4), banner persistente de contexto.
- `src/app/(admin)/login/page.tsx` — login isolado (cookie próprio? no mínimo: **validação server-side de platform_admin ativo** a cada request; sessão admin + customer podem coexistir no mesmo navegador mas nenhum caminho concede acesso cross-app).
- Middleware server-side `requireAdminSession()` — reusa `requirePlatformAdmin()` + verifica AAL2 em `supabase.auth.getSession()`. Se AAL<2, redireciona para `/mfa-enroll`.
- `src/app/(admin)/mfa-enroll/page.tsx` — fluxo TOTP via Supabase `auth.mfa.enroll`.
- **CI gate G-04** configurado em `scripts/check-import-isolation.mjs`: verifica que `src/app/(app)/**` não importa de `src/app/(admin)/**` nem de `src/lib/auth/platformAdmin.ts`, e que o bundle customer não inclui módulos admin-only. Integrado em `npm run build:check`.
- Sessão admin expira em 8h de inatividade (D-8) — configurado via Supabase auth settings.

**Gates cobertos:** G-01 (MFA enforcement), G-04 (import isolation), G-05 (session isolation).

**Riscos:** MFA no Supabase exige habilitação no projeto (config dashboard) — tarefa manual, documentar no runbook.

**Critérios de aceite:**
- Acesso a `/admin/dashboard` sem sessão → redireciona para `/admin/login`.
- Login sem MFA enrolado → força enrollment.
- Usuário com AAL2 mas **sem** `platform_admins` ativo → 403.
- `npm run build:check` falha se for adicionado `import '@/lib/auth/platformAdmin'` em qualquer arquivo sob `(app)/`.

---

### Sprint 05 — CRUD organizations: listagem, filtros, detalhe, suspender/reativar

**Nível:** STANDARD · **Modelo:** Opus / Opção 2 (primeiro sprint de UI admin + RPCs com audit + proteção org interna).

**Objetivo:** Primeiro CRUD útil da área admin. Ao final, admin Axon onboarda, suspende e reativa orgs sem SQL manual (RF-ORG-1..RF-ORG-9).

**DB (`@db-admin`):**
- RPC `admin_suspend_organization(org_id, reason)` — valida RF-ORG-7 (G-07 — rejeita para org interna), grava audit `'org.suspend'`, seta `organizations.is_active=false`. Efeito de bloqueio dos customer users: policy em tabelas sensíveis passa a testar `organizations.is_active` e JWT claim.
- RPC `admin_reactivate_organization(org_id)` — simétrica.
- RPC `admin_create_organization(name, slug, plan_id, first_admin_email)` — cria org + subscription `trial` com duração default (valor virá de platform_settings no Sprint 09; até lá, 14 dias hardcoded) + convite do primeiro admin (usa infra de `invitations` existente).
- Remover coluna compat `organizations.plan` (finaliza migração do Sprint 01).
- Índices para filtros de listagem (`status`, `is_active`, `created_at`, FK `subscription.plan_id`).

**Código (`@frontend+` + `@backend`):**
- `(admin)/organizations/page.tsx` — lista paginada com filtros (status subscription, plano, ativa/suspensa, data criação) + busca por nome/slug. Usa padrão de listagem do design system.
- `(admin)/organizations/new/page.tsx` — form de criação (RF-ORG-3), slug auto-sugerido com preview editável.
- `(admin)/organizations/[id]/page.tsx` — detalhe (metadados, plano atual, subscription, users count, data última atividade).
- Ações de suspender/reativar com confirmação explícita digitando o slug (RNF-UX-2).
- Toda mutation grava audit.

**Gates cobertos:** G-07 (proteção org interna), G-18 (performance listagem — índice + query plan verificado), G-16 (golden flow: criar + suspender + reativar entra na suíte).

**Riscos:** a policy de bloqueio por `is_active=false` toca várias tabelas do customer — mapear exaustivamente. Alternativa considerada e preterida: bloqueio via middleware. Decisão: RLS (defesa em profundidade).

**Critérios de aceite:**
- Listagem de 1000 orgs responde em <500ms (RNF-PERF-2).
- Tentar suspender a org AxonAI (UI ou RPC direto) falha com erro tipado.
- Customer user de org suspensa vê tela explicativa "sua conta foi suspensa, contate o suporte" (não 401/403 genérico).

---

### Sprint 06 — CRUD de plans + ciclo de vida de subscription

**Nível:** STANDARD · **Modelo:** Opus / Opção 2 (regras de negócio: upgrade/downgrade, estender trial, cancelar, INV-1/INV-2/INV-8).

**Objetivo:** Admin opera comercialmente — cria plano, ajusta preço/limites, troca plano de uma org, estende trial, cancela, reativa. Respeita INV-2 (plano em uso não exclui) e INV-8 (trial nunca reiniciado).

**DB (`@db-admin`):**
- RPC `admin_change_plan(subscription_id, new_plan_id, effective_at)` — valida downgrade vs uso atual (RF-SUB-4), grava audit `'subscription.change_plan'` com diff de limites.
- RPC `admin_extend_trial(subscription_id, days)` — só se status=`trial` (INV-8 — não reinicia); acumula em `metadata.trial_days_override`.
- RPC `admin_cancel_subscription(subscription_id, effective_at)` e `admin_reactivate_subscription(subscription_id)`.
- RPC `admin_archive_plan(plan_id)` e `admin_delete_plan(plan_id)` — delete falha se existir subscription ativa no plano (INV-2).
- Lazy trial expiry check: função `check_and_update_expired_trials(org_ids uuid[])` chamada pelo middleware admin (transição automática real vem no Sprint 13).

**Código (`@frontend+` + `@backend`):**
- `(admin)/plans/*` — CRUD completo (lista/novo/editar/archive).
- `(admin)/organizations/[id]/subscription` — ações: trocar plano (seleção + preview de impacto nos limites), estender trial, cancelar, marcar `past_due`, reativar.
- Todas as ações: confirmação explícita + audit.

**Gates cobertos:** G-11 (plano em uso não exclui), G-12 (INV-1 reforçado — teste concorrente), G-06 (billing actuando sem poder administrativo; support sem poder de billing).

**Riscos:** race condition em duas ações concorrentes na mesma subscription (T-13). **Mitigação:** `SELECT ... FOR UPDATE` no RPC ou `updated_at` como optimistic lock.

**Critérios de aceite:**
- Tentar excluir plano com 1+ subscription ativa falha com erro tipado.
- Estender trial de org que já saiu de trial retorna erro "trial não pode ser reiniciado".

---

### Sprint 07 — Hard-enforcement de limites + `plan_grants`

**Nível:** STANDARD · **Modelo:** Opus / Opção 2 (cross-cutting em todos os Server Actions de criação).

**Objetivo:** Toda criação de recurso contável (user, lead, produto, pipeline, integração, storage) no customer app é rejeitada **na mesma transação** se faz a org exceder o limite do plano vigente (RF-LIMIT-1, T-21).

**DB (`@db-admin`):**
- `plan_grants` — `id`, `organization_id`, `limit_key text CHECK IN (...)`, `value_override int` (NULL = ilimitado), `reason text NOT NULL`, `expires_at` nullable, `created_by`, `revoked_at` nullable. FORCE RLS.
- RPC `enforce_limit(org_id, limit_key, delta int)` `SECURITY DEFINER` — retorna erro tipado `P0001` com code `'plan_limit_exceeded'` se consumir>limit (plano + grants ativos).
- RPCs `admin_grant_limit(...)` e `admin_revoke_grant(...)` com audit.

**Código (`@backend`):**
- Aplica chamada a `enforce_limit(...)` em cada Server Action de criação no customer app: `leads.ts`, `products.ts`, `funnels.ts`, `invitations.ts` (users), `whatsapp-groups.ts` (integrations), upload em `product-images.ts`/`product-documents.ts` (storage em MB).
- Tradução do erro tipado no frontend para mensagem padrão "seu plano permite até N {recurso}; faça upgrade ou contate o suporte".
- UI admin: `(admin)/organizations/[id]/grants` — listar, criar, revogar grant.

**Gates cobertos:** G-19 (enforcement — teste por cada caminho de criação), G-02 (cross-tenant isolation revalidado em cada Server Action tocado).

**Riscos:** paths de criação não-óbvios (bulk import, webhook de API externa futura) podem escapar. **Mitigação:** listar inventário exaustivo no spec (Opção 2) e adicionar comentário `// enforce_limit` obrigatório como código-review checklist.

**Critérios de aceite:**
- Tentativa de criar lead acima do limite falha com status tipado; nada persiste; audit opcional (criação recusada não é ação admin — fica fora de audit_log, vai para log de aplicação).
- Grant com `expires_at` no passado é tratado como ausente.

---

### Sprint 08 — Deep Inspect: suporte read-only

**Nível:** STANDARD · **Modelo:** Sonnet / Opção 1 (primariamente view layer — reusa componentes customer em modo readonly, com Reference Module `src/app/(app)`).

**Objetivo:** A partir do detalhe de uma org admin, admin navega pelos recursos do cliente em modo somente-leitura (leads, users, products, pipelines, categorias, tags, origens, loss reasons, whatsapp groups). Zero mutation possível.

**DB (`@db-admin`):**
- Policies adicionais de SELECT em cada tabela de cliente, permitindo leitura quando `actor` é platform admin ativo (consultado via função SECURITY DEFINER).
- RPC `inspect_log(org_id, resource_type, record_ids uuid[])` — grava audit `'inspect.read_<resource>'` com os ids consultados (RF-SUP-4, T-17).

**Código (`@frontend+`):**
- `(admin)/organizations/[id]/inspect/leads` (+products/users/funnels/etc.) — componentes espelho com prop `readonly`. Nenhum botão/form/atalho de mutação renderizado (RF-SUP-2).
- Banner persistente no topo: "Você está vendo dados de **<ORG_NAME>** em modo inspeção".
- Hook `useInspectAudit(resourceType)` que chama `inspect_log` com os ids da tela carregada (uma chamada por página).
- Escape/sanitização explícita de qualquer dado renderizado — testado com payloads XSS conhecidos (G-09, T-10).

**Gates cobertos:** G-09 (XSS no dado do cliente — teste dedicado); G-02 (isolamento entre orgs: inspecionar org A não vaza dado de org B).

**Riscos:** duplicação de componentes customer — usar props condicionais em vez de fork. Documentar em `docs/APRENDIZADOS.md` o padrão se surgir armadilha.

**Critérios de aceite:**
- Nenhum formulário mutation renderizado em `/admin/organizations/[id]/inspect/*` (verificado mecanicamente por grep de `<form action=`).
- Payload `<img src=x onerror=alert(1)>` em nome de lead não executa.

---

### Sprint 09 — Dashboard home + platform settings base (flags + trial + políticas legais)

**Nível:** STANDARD · **Modelo:** Opus / Opção 2 (performance de métricas + schema de settings + versionamento de políticas).

**Objetivo:** Entregar a tela home com KPIs (RF-DASH-1..4) e a infra de platform settings que alimenta trial duration, feature flags e políticas legais.

**DB (`@db-admin`):**
- `platform_settings` — key/value tipado (`text`, `int`, `bool`, `jsonb`). Contém `trial_default_days`, `past_due_grace_days`, etc.
- `feature_flags` — `key text`, `enabled bool`, `config jsonb`. **Schema validado** (RF-SET-2) — RPC `admin_set_feature_flag` só aceita keys de uma lista canônica mantida em código (`src/lib/featureFlags/registry.ts`).
- `legal_policies` — `id`, `kind text CHECK IN ('terms','privacy','...')`, `version`, `effective_at`, `content_md`, `created_by`. Leitura pelo customer app: sempre a versão com `effective_at <= now()` mais recente. Append-only (nova versão não sobrescreve).
- Materialized view ou tabela de cache `platform_metrics_snapshot` com `active_orgs_count`, `active_users_count`, `leads_total`. Refresh via RPC `refresh_platform_metrics()` + job no Sprint 13.

**Código (`@frontend+` + `@backend`):**
- `(admin)/dashboard` — 3 KPIs da RF-DASH-1, badge "atualizado há Xmin", botão "atualizar agora" (chama `refresh_platform_metrics` com debounce).
- `(admin)/settings/feature-flags` — lista de flags registradas, toggle, audit.
- `(admin)/settings/trial` — configura `trial_default_days`, `past_due_grace_days`.
- `(admin)/settings/legal` — listar versões, criar nova (CM editor), apenas "effective at now()" ou "futuro agendado".

**Gates cobertos:** G-18 (dashboard <1s com dataset alvo — valida via snapshot cacheado); toda mudança de setting entra em audit.

**Riscos:** `count(*)` direto em `leads` vira gargalo em escala (RF-DASH-3). Por isso snapshot cached; recálculo via job.

**Critérios de aceite:**
- Dashboard carrega em <1s mesmo com 10M linhas de leads de teste (usa snapshot).
- Tentativa de criar flag com key não-registrada no registry é rejeitada.

---

### Sprint 10 — Credenciais cifradas + bootstrap email com fallback

**Nível:** STANDARD · **Modelo:** Opus / Opção 2 (cifragem + fluxo de fallback com impacto em UX).

**Objetivo:** Armazenar credenciais de integrações externas cifradas em repouso (RF-SET-4) e resolver bootstrap de email com fallback para env vars + geração de link copiável offline (RF-SET-7).

**DB (`@db-admin`):**
- Decidir cifragem: **pgsodium** (nativo Supabase) se disponível no projeto; alternativa Vault. Spec da Opção 2 **precisa decidir** e justificar.
- `platform_integration_credentials` — `id`, `kind text` (email/sms/...), `label`, `value_encrypted bytea`, `last_used_at`, `rotated_at`. FORCE RLS. Leitura plaintext só via RPC `get_credential(id)` `SECURITY DEFINER` chamada de código server-side autorizado (lista branca).
- Tabela `email_delivery_log` — status + link gerado quando fallback offline é usado.

**Código (`@backend`):**
- `src/lib/email/sender.ts` — escolhe fonte de credencial em ordem (RF-SET-7): platform_settings cifrado → env vars `BOOTSTRAP_EMAIL_*` → fallback offline (retorna `{ offlineLink }` que a UI mostra ao admin para envio manual).
- `(admin)/settings/integrations/email` — configurar credencial; UI mostra `last_used_at` e rotaciona, nunca exibe plaintext (G-14).
- Banner global na área admin: "Email não configurado" quando nenhuma fonte está presente.

**Gates cobertos:** G-14 (plaintext nunca na resposta — teste de inspeção de payload de `/api/admin/...`), audit de alterações/rotações.

**Riscos:** setup de pgsodium exige extensão + master key rotacionável — validar antes de iniciar o sprint.

**Critérios de aceite:**
- Nenhuma resposta JSON da área admin contém `value_encrypted` decodificado.
- Com `platform_settings` vazio e env vars ausentes, convite de admin gera link copiável e loga em `email_delivery_log` como `offline_fallback`.

---

### Sprint 11 — CRUD platform admins + convite single-use + password reset com MFA re-enroll

**Nível:** STANDARD · **Modelo:** Opus / Opção 2 (segurança sensível, RF-AUTH-7, G-15, G-22).

**Objetivo:** Completar gestão de operadores: convidar, alterar papel, desativar, reset senha com re-enroll forçado de MFA.

**DB (`@db-admin`):**
- `platform_admin_invitations` — `id`, `email`, `role`, `token uuid UNIQUE`, `expires_at`, `consumed_at nullable`. Single-use garantido por `UPDATE ... WHERE consumed_at IS NULL` atômico.
- Coluna `profiles.mfa_reset_required bool DEFAULT false`. Setada no `resetPassword` flow; middleware admin força re-enroll enquanto `true`.
- Trigger INV-3 reforçado (já criado no Sprint 02): testes adicionais no ciclo de UI.

**Código (`@frontend+` + `@backend`):**
- `(admin)/admins/*` — lista, convidar, alterar papel, desativar.
- Fluxo de convite usa `src/lib/email/sender.ts` (Sprint 10); token expira em 72h.
- `/admin/accept-invite/[token]` — consumo atômico + obrigatório MFA enroll antes de liberar acesso (RF-ADMIN-4).
- Fluxo de password reset: ao completar, seta `mfa_reset_required=true`; próximo login exige re-enroll antes de qualquer rota admin (G-22).
- **Step-up para reset de MFA de outro admin (T-15):** ação requer confirmação de um segundo owner (duplo). Pode ser uma fila "pending approval" — se o escopo ficar grande, virar sub-sprint 11b.

**Gates cobertos:** G-15 (convite single-use), G-22 (MFA re-enroll pós reset), G-08 revalidado (last-owner proteção no ciclo de UI).

**Riscos:** T-15 (downgrade de MFA por outro admin) é complexo. Se o step-up duplo inflar o sprint, tirar da Opção 2 e criar Sprint 11b dedicado.

**Critérios de aceite:**
- Consumir o mesmo token de convite 2x: segunda falha com erro tipado.
- Admin faz password reset → na próxima sessão, área admin redireciona para `/admin/mfa-enroll` antes de servir qualquer rota.

---

### Sprint 12 — Audit log UI + rate limit login admin + break-glass CLI

**Nível:** STANDARD · **Modelo:** Opus / Opção 2 (três superfícies distintas + break-glass sensível — G-21).

**Objetivo:** Fechar a malha de segurança/observabilidade operacional: visualização do audit, rate limit em login admin, procedimento formal de break-glass.

**DB (`@db-admin`):**
- `login_attempts_admin` — `id`, `email`, `ip`, `success bool`, `occurred_at`. Index em (email, occurred_at DESC). Policy para leitura admin apenas.
- Coluna `audit_log.retention_expires_at` (nullable) — reservada para D-7 (política de retenção); não usada ainda.

**Código (`@frontend+` + `@backend`):**
- `(admin)/audit` — listagem com filtros (admin, ação, entidade, período), paginação, detalhe com diff JSON pretty-printed.
- Middleware `src/lib/rateLimit/adminLogin.ts` — janela deslizante (5 falhas em 10min por email + 20 por IP em 10min) → 429 + audit `'auth.login_rate_limited'` (G-13).
- `scripts/break-glass.ts` — CLI versionado, requer `SUPABASE_SERVICE_ROLE_KEY` + `BREAK_GLASS_SECRET` + email do target. Executa: upsert `platform_admins` role=owner ativo, reseta MFA do profile, grava audit `'break_glass.recover_owner'` com metadata de quem executou. Exige confirmação digitada do email (RNF-UX-2).
- Runbook em `docs/admin_area/runbook_break_glass.md` (passos + rotação de `BREAK_GLASS_SECRET`).

**Gates cobertos:** G-13 (rate limit), G-21 (break-glass double-key + audit obrigatório — teste integrado que falta o segredo e espera rejeição, e teste positivo que grava linha).

**Riscos:** `BREAK_GLASS_SECRET` vazado no mesmo cofre que service role anula a defesa. Runbook **precisa** documentar cofres separados e cadência de rotação distinta (T-20).

**Critérios de aceite:**
- 6ª tentativa de login no mesmo email em 10min retorna 429 e gera audit.
- Executar `scripts/break-glass.ts` sem `BREAK_GLASS_SECRET` falha antes de tocar o banco.
- Executar com tudo certo cria/reativa o owner e escreve linha de audit com `action='break_glass.recover_owner'`.

---

### Sprint 13 — Transições automáticas + slug imutável pós-login + origin isolation de deploy

**Nível:** STANDARD · **Modelo:** Opus / Opção 2 (job agendado + deploy ops).

**Objetivo:** Fechar os automatismos e a separação de origem que o PRD marca como obrigatória.

**DB (`@db-admin`):**
- `organizations.first_login_at timestamptz nullable` + trigger que seta na primeira sessão de qualquer user daquela org. Trigger de UPDATE em `organizations.slug` rejeita mudança quando `first_login_at IS NOT NULL` (G-20, INV-9).
- pg_cron job `admin_transition_subscriptions` (horário) — chama RPC que:
  - `trial` com `period_end < now()` → `trial_expired` + audit `'subscription.auto_expire'`.
  - `past_due` excedendo grace → marca como bloqueada.
  - `cancelada` com fim de período pago → bloqueada.
- SLA alvo: <15min da expiração ao bloqueio (D-9).

**Código (`@backend` + ops):**
- Middleware admin mantém lazy-check como cinto (D-2): se cron atrasar, lazy atualiza no primeiro request admin que toca a subscription.
- Deploy: configurar subdomínio `admin.<host>` apontando para o mesmo app com rewrite que só serve `(admin)/**` (hostname gate no middleware). Customer host recusa qualquer rota admin. Cookie de sessão com `domain` explícito e `SameSite=Strict` (RNF-SEC-1, RNF-SEC-2).
- Docs de deploy em `docs/admin_area/deploy_origin_isolation.md`.

**Gates cobertos:** G-20 (slug imutável), G-23 (transições automáticas — teste que manipula `period_end` e valida flip em <1min em dev).

**Riscos:** pg_cron habilitação depende do tier do Supabase. Se indisponível, fallback para Edge Function + Vercel Cron.

**Critérios de aceite:**
- Trial com `period_end` passado vira `trial_expired` em <15min sem intervenção.
- Request a `/admin/dashboard` a partir do host customer retorna 404.
- Tentativa de PUT em `organizations.slug` após primeiro login registrado falha.

---

## 5. O que este plano NÃO cobre (intencionalmente)

- **Integração com gateway de pagamento** — fase 2 (PRD §5.2).
- **Impersonation real** — descartada no MVP (PRD §10.1).
- **RBAC granular além de 3 papéis** — fase 2.
- **Dashboard financeiro avançado (MRR/churn/LTV)** — fase 2.
- **Suíte de testes formal** — distribuída por sprint; inexiste framework de teste instalado hoje (stack: sem Vitest/Playwright). Cada sprint escreve os testes dos seus gates inline; se a suíte crescer e justificar harness dedicado, abrir sprint ops específico.
- **Wireframes** — design task separada, D-4 resolvido com paleta neutra.

---

## 6. Próximos passos

1. **Revisar este plano** com Edson. Mudanças estruturais (ordem, granularidade) entram aqui, não no sprint file.
2. Ao aprovar, disparar `@sprint-creator` para **Sprint 01** — ele consome este plano + o PRD e produz `sprints/active/sprint_01_plans_subscriptions_internal_org.md` com o formato completo (PRD técnico, checklist por agente, seção de recomendação, etc).
3. Rodar `Tech Lead...` no sprint file gerado.
