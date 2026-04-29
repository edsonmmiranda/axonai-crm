# Contexto do Projeto — Axon AI CRM

> **Este arquivo é a fonte permanente de decisões específicas deste projeto.**
> Vive em `docs/` fora do escopo do update script — sobrevive a `"Atualizar framework"`.
> O `@spec-writer` e o Tech Lead lêem este arquivo antes de qualquer sprint que envolva banco, auth ou arquitetura.

---

## 1. Identificadores de produção

| Entidade | UUID | Observação |
|---|---|---|
| Org interna Axon AI | `c6d506ca-08f0-4714-b330-6eb1a11f679b` | `slug='axon'`, `is_internal=true` |
| Profile Edson Miranda | `c0bb904c-0939-4b66-838e-eabf23df4377` | email: edsonmmiranda@gmail.com — ainda em org `pessoal`, não em `axon` (ver §4) |

---

## 2. Exceções em `public.*` — tabelas sem `organization_id`

Toda tabela em `public.*` deve ter `organization_id` para isolamento de tenant via RLS. As exceções abaixo são catálogos globais da plataforma e exigem proteção compensatória obrigatória.

| Tabela | Justificativa | Sprint | Proteção compensatória |
|---|---|---|---|
| `public.plans` | Catálogo comercial compartilhado; ligação com org é via `subscriptions.plan_id` | `admin_01` (2026-04-24) | RLS FORCE + policy SELECT só para planos públicos não arquivados + sem policies de mutação; writes via RPC `SECURITY DEFINER` |
| `public.platform_admins` | Catálogo de operadores Axon; escopado à org interna via FK `profile_id → profiles(id)` com `is_internal=true` | `admin_02` (2026-04-24) | RLS FORCE + policy SELECT restrita a `profile_id = auth.uid()` + sem policies de mutação; writes via RPC `SECURITY DEFINER` |
| `public.audit_log` | Log imutável de eventos da plataforma; `target_organization_id` é alvo do evento, não tenant do ator | `admin_03` (2026-04-24) | RLS FORCE + policy SELECT só para platform admins ativos + REVOKE de writes diretos + triggers de deny (UPDATE/DELETE/TRUNCATE) que bloqueiam inclusive `service_role`; writes via RPC `audit_write` SECURITY DEFINER |
| `public.platform_integration_credentials` | Catálogo global de credenciais cifradas (SMTP no MVP); secret real em `vault.secrets`. Credencial é da plataforma — sem org-tenant | `admin_10` (2026-04-27) | RLS FORCE + policy SELECT só para platform admins ativos + sem policies de mutação; writes via 3 RPCs `SECURITY DEFINER` (`admin_create/rotate/revoke_integration_credential`); `get_integration_credential_plaintext` é service-role-only (REVOKE nominal de `public`/`anon`/`authenticated`; GRANT só para `service_role`) e consumido só por `src/lib/email/getCredential.ts` |
| `public.email_delivery_log` | Rastro operacional de envios transacionais admin (incluindo fallback offline); evento da plataforma, não do tenant | `admin_10` (2026-04-27) | RLS FORCE + policy SELECT só para platform admins ativos + sem policies de mutação; writes via RPC `log_email_delivery` SECURITY DEFINER (service-role only). **Sem trigger de deny UPDATE/DELETE** — log operacional, não evidência forense (diferente de `audit_log`) |
| `public.platform_admin_invitations` | Convites single-use de novos platform admins (token UUID opaco, TTL 72h, consumo atômico via `UPDATE ... WHERE consumed_at IS NULL ... RETURNING *`); catálogo da plataforma admin escopado à org `slug='axon'` por convenção | `admin_11` (2026-04-28) | RLS FORCE + policy SELECT só para platform admin ativo + sem policies de mutação; writes via 3 RPCs SECURITY DEFINER (service-role only). 6 CHECKs de coerência (consume/revoke/terminal-state-xor) + UNIQUE parcial 1 pendente por email |
| `public.platform_admin_mfa_reset_requests` | Reset de MFA de admin com double step-up (target ≠ requester, target ≠ approver — requester pode ser approver); catálogo da plataforma admin. Hotfix 2026-04-29 baixou de triple para double step-up — ver §3 D-8 | `admin_11` (2026-04-28) | RLS FORCE + policy SELECT só para platform admin ativo + sem policies de mutação; writes via 4 RPCs SECURITY DEFINER (service-role only). CHECKs anti-bypass: `pamr_no_self_request` (target ≠ requester), `pamr_approver_not_target` (target ≠ approver). RPC `admin_approve_mfa_reset` re-valida `target_approve_forbidden` em runtime — defesa em profundidade contra bypass via service_role direto |
| `public.login_attempts_admin` | Append-only de tentativas de login na rota `/admin/login` (sucesso+falha); evento pré-autenticação — admin ainda não identificado quando login falha, mesmo no sucesso é evento da plataforma e não do tenant | `admin_12` (2026-04-28) | RLS FORCE + policy SELECT só para platform admin ativo `role IN ('owner','support')` (billing **não** lê — fora do escopo) + sem policies de mutação; writes via RPC `record_admin_login_attempt` SECURITY DEFINER (service-role only). **Sem trigger de deny UPDATE/DELETE** — log operacional, não evidência forense (purge eventual em fase 2) |

**Para adicionar nova exceção:** justificativa + proteção compensatória obrigatórias. Registrar aqui E documentar no header da migration.

---

## 3. Decisões de produto fixadas (ciclo Admin Area)

Fonte: `docs/admin_area/sprint_plan.md` §1. Alterar qualquer uma delas revisita o sprint correspondente.

| # | Decisão | Escolha | Sprint |
|---|---|---|---|
| D-1 | Onboarding de cliente | **Admin-gated entregue.** CRUD de organizations operacional no Sprint 05: admin cria org, gera link de convite para primeiro admin. Self-service retorna na fase 2. | 05 ✅ |
| D-2 | Transição de status de subscription | **Lazy-check no middleware admin** + **pg_cron horário** que reavalia `trial`/`past_due`/`cancelada`. Customer app lê `status` derivado. | 13 |
| D-3 | Origin isolation | **Subdomínio dedicado** `admin.<host>`. Customer host recusa qualquer rota `(admin)`. | 13 |
| D-4 | Branding admin | **"Axon Admin"**, paleta neutra escura. Tokens definidos no Sprint 04. | 04 |
| D-5 | `profiles.role` no código | **`'owner' \| 'admin' \| 'user' \| 'viewer'`** — alinhado ao DB. `'member'` foi removido do código no Sprint 02 (mantido só como legacy-mapping transitório em `normalizeRole`). | 02 ✅ |
| D-6 | Matriz RBAC platform admin | Definida em `docs/admin_area/rbac_matrix.md`. Papéis: owner/support/billing. Ortogonal a `profiles.role`. | 02 ✅ |
| D-7 | Retenção de audit log | **MVP retém indefinidamente.** Coluna `audit_log.retention_expires_at` criada e reservada (NULL = indefinido). Defaults sugeridos para fase 2: compliance/maioria 7 anos, `inspect.*` 90 dias, `auth.*` 1 ano, `break_glass.*` indefinido. Purge job é fase 2 (exige bypass dos triggers `audit_log_deny_*` via função SECURITY DEFINER dedicada). | 12 ✅ |
| D-8 | Duração da sessão admin | **8h inatividade, 12h absoluta.** Configurado via Supabase auth settings no Sprint 04. | 04 |
| D-9 | SLA de transição automática | **≤15min** da expiração ao bloqueio. pg_cron horário = máx 60min; lazy-check fecha a janela. | 13 |
| D-10 | Step-up no MFA reset de admin | **Double step-up** (não triple). Invariantes: `target ≠ requester` E `target ≠ approver`. A regra `requester ≠ approver` (4-eyes) foi removida no hotfix 2026-04-29 porque com `active_admins ≤ 2` ela tornava o flow normal matematicamente impossível e jogava todo reset no break-glass. Propriedade essencial preservada: ninguém reseta a própria MFA sem outro admin tomar uma ação. **Reintroduzir 4-eyes** quando `active_admins ≥ 3` se desejar (ADD CONSTRAINT `pamr_requester_distinct CHECK (approved_by IS NULL OR approved_by <> requested_by)` + RAISE `self_approve_forbidden` na RPC). | hotfix `admin_mfa_reset_double_step_up` |

---

## 4. Pendências operacionais abertas

| # | Pendência | Bloqueador | Sprint |
|---|---|---|---|
| OP-1 | Seed do primeiro platform admin owner (Edson) | Profile de Edson está em org `pessoal` (`c0bb904c`), não em `axon`. Mover via runbook antes de executar `seed_initial_platform_admin_owner`. Ver `docs/admin_area/runbook_seed_owner.md`. | Pós sprint_admin_02 |

---

## 5. Estado de schema (sprint_admin_05, 2026-04-25)

- Coluna `organizations.plan` **removida** — todos os callers usam `getOrgPlan()` / `get_current_subscription`.
- `pg_trgm` instalado — índice GIN em `organizations.name` para busca por nome.
- `is_calling_org_active()` ativa — 55 políticas customer bloqueiam orgs suspensas via RLS.
- RPCs: `admin_create_organization`, `admin_suspend_organization`, `admin_reactivate_organization` (todas SECURITY DEFINER, anon revogado).

## 5b. Estado de schema (sprint_admin_07, 2026-04-26)

- Tabela `public.plan_grants` criada (FORCE RLS, append-only via RPCs SECURITY DEFINER, policy SELECT só para platform admins ativos).
- RPCs: `enforce_limit(org_id, limit_key, delta)` (chamada por Server Actions customer; raise `plan_limit_exceeded` P0001 com DETAIL JSON), `admin_grant_limit`, `admin_revoke_grant` (todas SECURITY DEFINER, anon revogado).
- **Coluna `organization_id` confirmada como direta** em `product_images` e `product_documents` (denormalização não documentada nas migrations versionadas — apenas na introspecção viva).
- Hard-enforcement ativo em **7 Server Actions customer** (leads, products, funnels, invitations, whatsapp-groups, product-images, product-documents) via helper `src/lib/limits/enforceLimit.ts`. Convenção `// enforce_limit: not-applicable — <razão>` obrigatória em qualquer nova Server Action de criação de recurso contável que escolha não chamar.
- RF-LIMIT-1 / T-21 entregues. Sprint 09 traz cache de consumo via materialized view (queries `count(*)`/`SUM` em `enforce_limit` rodam direto por enquanto).

## 5c. Estado de schema (sprint_admin_09, 2026-04-27)

- Tabelas globais novas (sem `organization_id` — exceção documentada em §2): `platform_settings`, `feature_flags`, `legal_policies`, `platform_metrics_snapshot`. Todas FORCE RLS, writes apenas via RPCs SECURITY DEFINER.
- **`platform_settings`**: key/value tipado com CHECK exatidão (`platform_settings_exactly_one_value`). Seeds: `trial_default_days=14`, `past_due_grace_days=7`, `signup_link_offline_fallback_enabled=true`.
- **`feature_flags`**: registry canônico em `src/lib/featureFlags/registry.ts` + `get_registered_feature_flag_keys()` (SQL) — **manter sincronizados**. Seeds: `enable_public_signup=false`, `enable_ai_summarization=false`.
- **`legal_policies`**: append-only por trigger deny UPDATE/DELETE/TRUNCATE (mesmo padrão `audit_log`). Trigger `legal_policies_set_version` (BEFORE INSERT) calcula version via `pg_advisory_xact_lock`. UNIQUE `(kind, version)`.
- **`platform_metrics_snapshot`**: singleton (id=1). Refresh manual + lazy (>15min). Debounce de audit: pula se mesmo ator refrescou <60s atrás.
- **`createOrganizationAction`** (Sprint 05) atualizado: lê `trial_default_days` de `platform_settings` com fallback 14. RPC `admin_create_organization` já aceitava `p_trial_days` — mudança foi no Server Action.
- `audit_write` aceita `target_id=NULL` para tabelas com PK text/int (setting.update, feature_flag.set, metrics.refresh) — key/id vai em `metadata`.
- RPCs novas: `admin_set_setting`, `admin_set_feature_flag`, `get_registered_feature_flag_keys`, `get_active_feature_flags`, `admin_create_legal_policy`, `get_active_legal_policy`, `refresh_platform_metrics`.

## 5e. Estado de schema (sprint_admin_11, 2026-04-28)

- **Coluna nova `profiles.mfa_reset_required boolean NOT NULL DEFAULT false`** — flag setada por `mark_admin_password_reset` (após password reset Supabase) ou por `admin_approve_mfa_reset` (step-up). Lida pelo middleware `requireAdminSession` (modificado no Sprint 11) → redireciona `/admin/*` para `/admin/mfa-enroll?reenroll=true` enquanto `true`. Resetada por `complete_admin_mfa_reenroll` (sem step-up) ou `consume_admin_mfa_reset` (com step-up).
- **2 tabelas globais novas** (sem `organization_id` — exceções §2): `platform_admin_invitations` e `platform_admin_mfa_reset_requests`. Ambas FORCE RLS + sem policies de mutação + writes via RPCs SECURITY DEFINER service-role only.
- **15 RPCs novas** (todas SECURITY DEFINER, `set search_path=public`, REVOKE explícito de `public/anon/authenticated`, GRANT só `service_role` — APRENDIZADO 2026-04-24):
  - Mutações invitations (owner-only): `admin_create_platform_admin_invitation`, `admin_revoke_platform_admin_invitation`, `admin_consume_platform_admin_invitation`
  - Mutações admin (owner-only): `admin_change_platform_admin_role`, `admin_deactivate_platform_admin`
  - Step-up MFA reset (owner-only): `admin_request_mfa_reset`, `admin_approve_mfa_reset`, `admin_revoke_mfa_reset_request`, `consume_admin_mfa_reset`
  - Auth flow: `mark_admin_password_reset`, `complete_admin_mfa_reenroll`
  - Reads: `admin_list_platform_admins`, `admin_list_platform_admin_invitations`, `admin_list_mfa_reset_requests`, `get_invitation_by_token`
- **Atomicidade single-use (G-15):** `admin_consume_platform_admin_invitation` faz `UPDATE ... WHERE token=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING *` — Postgres atomic em READ COMMITTED garante que apenas 1 transação concorrente vence. Falha classifica via SELECT auxiliar para erros tipados.
- **Step-up duplo:** 3 invariantes anti-bypass enforçadas tanto por CHECK constraint (`pamr_no_self_request`, `pamr_approver_distinct`) quanto por re-validação na RPC `admin_approve_mfa_reset` com `SELECT FOR UPDATE`.
- **Decisão técnica `set_config('request.jwt.claims', ...)`:** `createServiceClient()` não passa JWT do user, então `auth.uid()` retorna NULL dentro de RPCs chamadas via Server Action. Cada RPC mutation aceita `p_actor_profile_id` explícito e injeta no JWT context da TX (`PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_actor_profile_id::text)::text, true)`) antes de chamar `audit_write` — captura actor corretamente. Defesa em profundidade: RPC valida que `p_actor_profile_id` é platform admin owner ativo.
- **Limitação Postgres (UNIQUE parcial sem `now()`):** índices `pai_one_pending_per_email_idx` e `pamr_one_pending_per_target_idx` não incluem `expires_at > now()` no predicate (Postgres exige IMMUTABLE). RPCs `admin_create_platform_admin_invitation` e `admin_request_mfa_reset` aplicam cleanup-on-write (auto-revoke de expirados não-revogados antes do INSERT) para liberar o slot.
- **Integração com Sprint 10:** `platform_admin_invitations.email_delivery_log_id` é FK lógica (sem FK física) para `email_delivery_log.id`. `email_delivery_log.related_entity_type` já aceitava `'platform_admin_invitation'` (CHECK criado no Sprint 10).
- **11 action slugs novos no audit_log:** `platform_admin.invite_create/invite_revoke/invite_consume/role_change/deactivate/mfa_reset_request/mfa_reset_approve/mfa_reset_revoke/mfa_reset_consume` + `password_reset.complete_admin/mfa_reenroll_complete`.

## 5d. Estado de schema (sprint_admin_10, 2026-04-27)

- Tabelas globais novas (sem `organization_id` — exceções documentadas em §2): `platform_integration_credentials`, `email_delivery_log`. Ambas FORCE RLS, writes apenas via RPCs SECURITY DEFINER.
- **Cifragem em repouso via Supabase Vault** (extension `supabase_vault` v0.3.1, já habilitada). Decisão Vault vs pgsodium: Vault tem chave gerenciada pelo Supabase e está pré-instalado; pgsodium exigiria setup de master key + privilégios extras. Secrets vivem em `vault.secrets`; decifragem via `vault.decrypted_secrets` apenas dentro de RPC `SECURITY DEFINER`.
- **`platform_integration_credentials`**: 1 ativa por kind (UNIQUE parcial `(kind) WHERE revoked_at IS NULL`). Hint mascarado (`****` + 4 chars finais) na coluna `hint`; nunca permite reconstrução do plaintext. Audit em create/rotate/revoke contém apenas `{kind, label, hint}` — **nunca plaintext nem `vault_secret_id`** (G-14).
- **`email_delivery_log`**: rastro operacional (sem trigger de deny UPDATE/DELETE — admin pode purgar antigos). Audit row apenas em `source='offline_fallback'` (alta frequência inflaria audit). CHECK composto enforça combinações válidas `(source, status)`: `platform_setting|env_var × sent|error` ou `offline_fallback × fallback_offline`.
- **7 RPCs novas** (todas `SECURITY DEFINER`, `SET search_path=public`, REVOKE nominal de `public`/`anon`/`authenticated` — APRENDIZADO 2026-04-24):
  - `admin_create_integration_credential` / `admin_rotate_integration_credential` / `admin_revoke_integration_credential` — owner-only via `requirePlatformAdminRole(['owner'])` no Server Action; RPC re-valida.
  - `admin_list_integration_credentials` — projeção sem `vault_secret_id` (defesa em profundidade).
  - `get_integration_credential_plaintext` — **⛔ único caminho** ao plaintext fora do Vault. GRANT EXECUTE apenas para `service_role`. Consumido só por `src/lib/email/getCredential.ts`.
  - `mark_credential_used` — UPDATE `last_used_at`; permite UPDATE em soft-revoked (envio em flight conclui).
  - `log_email_delivery` — service-role only; trunca `error_message` a 1000 chars.
- **Fallback chain de email** (`src/lib/email/getCredential.ts`, cacheado por request via React `cache()`):
  1. **DB/Vault** via RPC `get_integration_credential_plaintext`.
  2. **Env vars** `BOOTSTRAP_EMAIL_HOST/USER/PASSWORD` (todos os 3 obrigatórios; `PORT/FROM/SECURE` com defaults).
  3. **Offline fallback** gated por setting `signup_link_offline_fallback_enabled` (Sprint 09). Caller passa `offlineLink` pré-construído — sender NÃO gera signed URLs.
- **Contrato `EmailDeliveryResult`** (em `src/lib/email/sender.ts`) é discriminated union: `{status: 'sent' | 'fallback_offline' | 'error', deliveryLogId, ...}`. Sprint 11 (CRUD platform admins + convite single-use) consumirá `sendEmail()` para enviar tokens de convite.
- **Server-only enforcement:** `import 'server-only'` no topo de `getCredential.ts`/`sender.ts`/`getEmailSourceStatus.ts`. `nodemailer` (`@types/nodemailer`) importado APENAS em `sender.ts`.
- **Banner global "Email não configurado"** renderizado pelo `AdminShell` em todas as rotas `/admin/*` quando ambas DB e env vars estão vazias: warning amarelo se fallback ativo; danger vermelho se desativado.
- **Dep nova:** `nodemailer` + `@types/nodemailer` adicionados ao `package.json`.

## 5g. Estado de schema (sprint_admin_13, 2026-04-29)

- **Trigger `prevent_slug_change`** em `public.organizations` (BEFORE UPDATE OF slug). Slug é **imutável desde a criação** (decisão simplificada 2026-04-29 — versão original com `first_login_at` foi descartada). UPDATE no-op (mesmo slug) é permitido para idempotência. Mudança operacional exige runbook fora da UI (DROP TRIGGER → UPDATE → recreate).
- **Função estendida `is_calling_org_active()`**: além de `organizations.is_active`, agora retorna `false` quando existe subscription da org com `status IN ('trial_expired','suspensa')`. Cron + lazy garantem que status reflete realidade dentro do SLA de 15min (D-9). 55 policies customer continuam usando `is_calling_org_active()` — bloqueio agora cobre subscriptions vencidas automaticamente.
- **3 RPCs novas** (todas `SECURITY DEFINER`, `SET search_path=public`, REVOKE público/anon/authenticated, GRANT só `service_role` — APRENDIZADO 2026-04-24):
  - `_apply_subscription_transitions(p_org_id uuid DEFAULT NULL, p_source text DEFAULT 'cron')` — função privada que aplica as 3 transições (trial→trial_expired; past_due+grace→suspensa; cancelada+vencido→suspensa) + audit por linha. `FOR UPDATE SKIP LOCKED` evita contenção entre cron e lazy. Source whitelist: `cron | lazy_middleware | manual_admin`.
  - `admin_transition_subscriptions()` — wrapper para o pg_cron job (NULL = todas as orgs).
  - `admin_transition_subscription_for_org(p_org_id uuid)` — wrapper para o lazy-check do middleware admin.
- **Extensão `pg_cron` 1.6.4** instalada. Job `admin_transition_subscriptions_hourly` agendado em `0 * * * *` (top of hour), active=true. Idempotência: migration faz `unschedule + reschedule` se job já existe.
- **3 action slugs novos no audit_log:** `subscription.auto_expire`, `subscription.auto_block_past_due`, `subscription.auto_block_cancelled`. Todas com `metadata->>'source'` indicando origem (`cron` ou `lazy_middleware`). `actor_profile_id=NULL` quando chamado por cron — `audit_write` já lida via `auth.uid()` que retorna NULL fora de JWT context.
- **Hostname gate em `src/middleware.ts`** (Sprint 13): hostnames vêm de `NEXT_PUBLIC_ADMIN_HOST` e `NEXT_PUBLIC_CUSTOMER_HOST`. `<customer>/admin/*` → 404; `<admin>/<non-admin>` → 404; dev (localhost/127.0.0.1) → permissivo com warning único. Em prod sem env vars, hard-fail 503 em `/admin/*`. Lógica em `src/lib/middleware/hostnameGate.ts` (função pura testável).
- **Cookies de sessão isolados** (Sprint 13): `setAll` do `createServerClient` no middleware injeta `domain` = host atual + `SameSite=Strict` quando host não inclui `localhost`/`127.0.0.1`. Sessão admin emitida em `admin.<host>` não vaza para customer host. Docs operacionais em `docs/admin_area/runbook_origin_isolation.md`.
- **Server Action nova:** `triggerLazyTransitionAction` em `src/lib/actions/admin/subscription-transitions.ts`. Chama RPC `admin_transition_subscription_for_org` via service client. Defesa em profundidade: `requirePlatformAdmin()` + check `isActive` antes do RPC. Revalida `/admin/organizations/{id}` e `.../subscription` quando `transitioned > 0`.
- **`triggerLazyTransitionAction` ainda não está integrada ao middleware admin** (não havia ponto natural de chamada sem refactor). Próxima oportunidade: invocar de Server Component em `(admin)/organizations/[id]/page.tsx` (ou layout) — fica como follow-up operacional.

## 5f. Estado de schema (sprint_admin_12, 2026-04-28)

- **1 tabela nova `public.login_attempts_admin`** (sem `organization_id` — exceção §2): registro append-only de tentativas de login admin (sucesso+falha). FORCE RLS + policy SELECT só para platform admin `role IN ('owner','support')`. Sem trigger de deny UPDATE/DELETE (purge eventual em fase 2). 3 índices: `(email, occurred_at DESC)`, `(ip_address, occurred_at DESC)`, `(occurred_at DESC)`. Coluna `email_hash bytea` derivada via `digest(lower(email),'sha256')` no INSERT-time pela RPC.
- **1 coluna nova `audit_log.retention_expires_at timestamptz NULL`** — reservada para D-7 (decisão fixada §3: MVP retém indefinidamente). Sem enforcement no MVP — purge job é fase 2.
- **5 RPCs novas** (todas `SECURITY DEFINER`, `set search_path=public`, REVOKE explícito de `public/anon/authenticated`, GRANT só `service_role` — APRENDIZADO 2026-04-24):
  - `record_admin_login_attempt(p_email, p_ip, p_user_agent, p_success)` — INSERT em `login_attempts_admin`. Sem audit row (volume).
  - `count_admin_login_failures(p_email, p_ip, p_window)` STABLE — `jsonb_build_object('by_email', ..., 'by_ip', ...)` para sliding-window. Sem `FOR UPDATE` (decisão (a) — tolerância ~10ms aceitável).
  - `audit_login_admin_event(p_email, p_ip, p_user_agent, p_action, p_metadata)` — emite linha em `audit_log`. Whitelist de actions (`auth.login_admin_success` | `auth.login_rate_limited`). Resolve `actor_profile_id` apenas em sucesso (rate-limited = atacante anônimo). INSERT direto em `audit_log` para retornar id (em vez de chamar wrapper `audit_write`).
  - `get_break_glass_secret_hash()` STABLE — read do hash em `platform_settings.value_text` com `key='break_glass_secret_hash'` e `value_type='text'`. Retorna NULL se setting não seedado (CLI falha com mensagem clara).
  - `break_glass_recover_owner(p_email, p_operator, p_origin_host)` — operação atômica em transação: SELECT FOR UPDATE em `platform_admins` + UPSERT manual (UPDATE existente OR INSERT novo, role='owner', is_active=true, deactivated_at=NULL) + UPDATE `profiles.mfa_reset_required=true` + INSERT em `audit_log` com `action='break_glass.recover_owner'` + metadata (`operator`, `origin_host`, `platform_admin_id`, `restored_role`). MFA factor invalidation NÃO acontece no RPC — é responsabilidade do CLI via Auth Admin API JS (decisão (d)).
- **3 action slugs novos no audit_log:** `auth.login_admin_success`, `auth.login_rate_limited`, `break_glass.recover_owner`.
- **Idempotência do break-glass:** RPC é idempotente (rerun seguro — UPSERT manual + UPDATE flag). Auth Admin API (deletar TOTP factors) também idempotente (rerun com lista vazia = no-op). Estado convergente em qualquer ordem.
- **Trade-off de volume:** login admin success **emite** audit row (RF-AUDIT-1 lista login admin como ação sensível); login admin failure **não** emite audit (volume em ataque seria proibitivo) — apenas `login_attempts_admin`. Rate limit triggered emite audit (alta-sinal/baixo-volume).
- **Limitação documentada:** `audit_log` SELECT policy permissiva para qualquer platform admin ativo (Sprint 03 design); RBAC para `billing` (regex `^(plan|subscription|grant|org)\.`) é enforced **apenas application-level** na Server Action `listAuditLogAction`. Defesa em profundidade adicional (RLS por role) é fora-de-escopo MVP.
- **Triggers preservados** (G-10): `audit_log_deny_truncate` + `audit_log_deny_update_delete` ainda ativos. Sprint 12 NÃO modifica triggers nem indexes existentes de `audit_log` — apenas adiciona coluna reservada.

---

## 6. Convenções específicas deste projeto

- **Prefixo de sprint files do ciclo admin:** `sprint_admin_XX_` (ex: `sprint_admin_03_audit_log.md`).
- **Audit log:** toda mutation sensível admin chama `audit_write` dentro da mesma transação. Ver `docs/conventions/audit.md`.
- **Ortogonalidade de roles:** `profiles.role` (tenant, customer app) é completamente separado de `platform_admins.role` (plataforma, admin app). Nunca converter entre os dois.
- **Slug da org interna:** `axon` — imutável. Usado como referência em seeds e testes.
