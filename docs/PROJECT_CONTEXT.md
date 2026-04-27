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
| D-7 | Retenção de audit log | A decidir antes do Sprint 12 ir pra prod. Coluna `retention_expires_at` reservada. | 12 |
| D-8 | Duração da sessão admin | **8h inatividade, 12h absoluta.** Configurado via Supabase auth settings no Sprint 04. | 04 |
| D-9 | SLA de transição automática | **≤15min** da expiração ao bloqueio. pg_cron horário = máx 60min; lazy-check fecha a janela. | 13 |

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

---

## 6. Convenções específicas deste projeto

- **Prefixo de sprint files do ciclo admin:** `sprint_admin_XX_` (ex: `sprint_admin_03_audit_log.md`).
- **Audit log:** toda mutation sensível admin chama `audit_write` dentro da mesma transação. Ver `docs/conventions/audit.md`.
- **Ortogonalidade de roles:** `profiles.role` (tenant, customer app) é completamente separado de `platform_admins.role` (plataforma, admin app). Nunca converter entre os dois.
- **Slug da org interna:** `axon` — imutável. Usado como referência em seeds e testes.
