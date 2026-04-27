# Sprint admin_09: Dashboard home + platform settings base (flags + trial + políticas legais)

> **Nível:** STANDARD
> **Ciclo:** Admin Area · Sprint 09 de 13
> **Plano fonte:** [`docs/admin_area/sprint_plan.md`](../../docs/admin_area/sprint_plan.md) § Sprint 09
> **PRD fonte:** [`docs/admin_area/admin_area_prd.md`](../../docs/admin_area/admin_area_prd.md) § RF-DASH-1..4, RF-SET-1..6, RF-PLAN-6, RNF-PERF-1, T-19, INV-6
> **Dependências satisfeitas:** sprint_admin_01 ✅ (`organizations.is_internal`, `subscriptions.status`) · sprint_admin_02 ✅ (`requirePlatformAdmin`/`requirePlatformAdminRole`) · sprint_admin_03 ✅ (`audit_write` + `writeAudit` helper) · sprint_admin_04 ✅ (shell `/admin/*` + `AdminShell`/`AdminSidebar`) · sprint_admin_07 ✅ (padrão de Server Action admin com audit transacional)
> **Dependências NÃO satisfeitas (intencional):** sprint_admin_08 (Deep Inspect) — não bloqueia 09; podem ser executados em qualquer ordem.
> **Estado do banco consultado direto via MCP** — não usar `docs/schema_snapshot.json` para esta sprint.

---

## 🎯 Objetivo de Negócio

Entregar a **home da área admin** (RF-DASH-1..4) com 3 KPIs em tempo aceitável (<1s mesmo com 10M leads — RNF-PERF-1) e a **infraestrutura de Platform Settings** que alimenta o resto do produto:

1. **Feature flags globais** com schema validado contra registry em código (RF-SET-1, RF-SET-2) — typo em key vira erro tipado, não silent failure.
2. **Settings de trial e billing** (`trial_default_days`, `past_due_grace_days`) — consumidos pelos Sprints 06 (já hardcoded em 14 dias) e 13 (transições automáticas).
3. **Políticas legais versionadas** (Termos, Privacidade) — append-only, customer app lê a versão vigente (`effective_at <= now()` mais recente) (RF-SET-5).

Esta sprint **não** mexe no `enforce_limit` do Sprint 07 — o `platform_metrics_snapshot` introduzido aqui serve **somente** ao dashboard. A migração do `enforce_limit` para consumir o snapshot fica para fase futura quando a SUM em `storage_mb` virar gargalo.

**Métrica de sucesso:**
- Dashboard `/admin/dashboard` carrega em **<1s** com 10M linhas de leads de teste (medido em CI ou via `EXPLAIN ANALYZE` documentado) — graças ao snapshot cacheado.
- KPIs **excluem** a org interna AxonAI (`is_internal=true`) das contagens de clientes (RF-DASH-2).
- Tentativa de criar feature flag com key fora do registry retorna erro tipado `'feature_flag_key_not_registered'`.
- Platform setting `trial_default_days` consumido por `admin_create_organization` substituindo o hardcode de 14 dias (Sprint 05).
- Customer app lê a política legal vigente via RPC `get_active_legal_policy('terms')` e exibe `content_md` renderizado.

---

## 👤 User Stories

- Como **platform admin owner**, quero ver na home 3 KPIs (orgs ativas, usuários ativos, leads totais) com timestamp da última atualização e um botão "atualizar agora", para que eu acompanhe o pulso do negócio sem abrir consultas SQL.
- Como **platform admin owner**, quero ativar/desativar feature flags pela UI (ex: `enable_public_signup`, `enable_ai_summarization`), para que eu rampee experimentos sem deploy.
- Como **platform admin owner**, quero configurar a duração default de trial e o grace period de `past_due` em uma única tela, para que novas orgs criadas no Sprint 05/06 e o cron do Sprint 13 leiam o valor correto.
- Como **platform admin billing**, quero ler (mas **não** alterar) feature flags e settings de trial para diagnóstico — RBAC: billing é R em settings, owner é RW.
- Como **platform admin owner**, quero criar uma nova versão dos Termos de Uso ou Política de Privacidade com data de vigência (agora ou futura), para que o customer app passe a referenciar a versão vigente automaticamente — sem sobrescrever a versão anterior (append-only para histórico legal).
- Como **customer user**, quero acessar a versão atual dos Termos via tela de aceite (fora do escopo desta sprint — só a infra de leitura), para que eu saiba qual contrato está em vigor.

---

## 🎨 Referências Visuais

- **Layout admin:** já existe — `src/app/admin/layout.tsx` + `src/components/admin/AdminShell.tsx`. Esta sprint **substitui** o conteúdo placeholder de `src/app/admin/dashboard/page.tsx` (Sprint 04) e adiciona um grupo "Configurações" no `AdminSidebar` com subitens `feature-flags`, `trial`, `legal`.
- **Dashboard:** layout em grid de 3 cards de KPI lado a lado em desktop, empilhados em mobile. Cada card: ícone + label + valor numérico grande + linha pequena "atualizado há Xmin" + botão sutil de refresh global no topo da página (não por card). Inspirado no padrão de detalhe da org (Sprint 05) e cards de assinatura (Sprint 06).
- **Settings — feature flags:** tabela densa: key, label (do registry), descrição, toggle on/off, "Ativado por <admin> em <data>". Padrão `OrganizationsList`/`PlansList` (Sprint 05/06).
- **Settings — trial:** form simples com 2 inputs numéricos (`trial_default_days`, `past_due_grace_days`), botão "Salvar" com confirmação por toast. Padrão `PlanForm` (Sprint 06).
- **Settings — legal:** tabela com versões existentes (kind, version, effective_at, criada por) + botão "Nova versão" que abre dialog/página com select de `kind`, datepicker `effective_at` ("agora" como default), textarea para `content_md` (renderização preview opcional). Versão criada com `effective_at` no futuro fica visível mas marcada como "Programada".
- **Componentes do design system a reutilizar:** `Button`, `Input`, `Select`, `Switch`/`Toggle`, `Textarea`, `Dialog`, `Table`, `Badge`, `Card`. Antes de criar variante inline, verificar a existente (APRENDIZADOS 2026-04-21).

---

## 🧬 Reference Module Compliance

**Parcialmente aplicável.**

1. **Para padrão de RPC com audit transacional + Server Action wrapper admin:** Sprint 05 (`admin_create_organization`, `admin_suspend_organization`), Sprint 06 (`admin_change_plan`, `admin_extend_trial`) e Sprint 07 (`admin_grant_limit`, `admin_revoke_grant`) são o **gold standard** — copiar literalmente: header de RPC com `SECURITY DEFINER`, `REVOKE EXECUTE FROM anon`, validação `requirePlatformAdminRole`, `audit_write(...)` na mesma transação, mapeamento de erro tipado em `actions/*.schemas.ts` → `actions/*.ts`.

2. **Para padrão de UI admin (lista + form/dialog + integração com sidebar):** Sprint 06 — `src/app/admin/plans/*` (list, new, edit) é a referência. Mesma estrutura: Server Component carrega lista, Client Component renderiza tabela com toolbar, Dialog para mutation, toast para feedback.

3. **Para o **dashboard** (cards KPI + refresh):** **não há reference module direto** — primeiro dashboard com métricas reais. O `@spec-writer` (Opção 2) define o snippet canônico de card KPI (`KpiCard`) que pode ser reutilizado em fase 2 quando vier dashboard financeiro avançado.

4. **Para **versionamento de políticas legais**:** **não há reference module direto** — primeiro recurso append-only por design (audit_log já é append-only mas é catálogo, não conteúdo editorial). O spec define a regra de leitura ("versão com `effective_at <= now()` mais recente para o `kind`") como SQL canônico em RPC.

**O que copiar:** estrutura de RPC com audit (Sprint 07), formato de `ActionResponse` mapeando erros tipados, padrão de UI lista+create-dialog (Sprint 06).
**O que trocar:** tabelas alvo (`platform_settings`, `feature_flags`, `legal_policies`, `platform_metrics_snapshot`), schemas Zod, payloads de audit (action slugs `setting.update` / `feature_flag.set` / `legal_policy.create` / `metrics.refresh`).
**O que NÃO copiar:** lógica de subscription/lifecycle (Sprint 06) nem cross-cutting em Server Actions customer (Sprint 07) — esta sprint não toca o customer app exceto pela leitura de `legal_policies` (que vem em sprint posterior; aqui apenas a RPC `get_active_legal_policy` fica disponível).

---

## 📋 Funcionalidades (Escopo)

### Backend

#### Banco de dados (autor: `@db-admin`)

- [ ] **Tabela `platform_settings`** (key/value tipado, key unique global):
  - Colunas:
    - `key text PRIMARY KEY` — slug em snake_case; CHECK (`length(key) BETWEEN 3 AND 64`)
    - `value_type text NOT NULL CHECK (value_type IN ('text','int','bool','jsonb'))`
    - `value_text text NULL`
    - `value_int int NULL`
    - `value_bool bool NULL`
    - `value_jsonb jsonb NULL`
    - `description text NOT NULL` — humano-legível, exibido na UI admin
    - `updated_at timestamptz NOT NULL DEFAULT now()`
    - `updated_by uuid NULL REFERENCES public.profiles(id)` — null em seeds iniciais
  - CHECK constraint exclusivo: exatamente uma das 4 colunas `value_*` é não-nula, batendo com `value_type`.
  - **FORCE RLS.** Policy SELECT: `requirePlatformAdmin`-equivalente (`is_platform_admin(auth.uid())`). **Sem policies de mutação** — writes via RPC `admin_set_setting`.
  - **Seeds iniciais:**
    - `trial_default_days = 14` (int)
    - `past_due_grace_days = 7` (int)
    - `signup_link_offline_fallback_enabled = true` (bool) — preparação Sprint 10
    - Seeds adicionais conforme `@spec-writer` decidir (mas **não** mover hardcodes do Sprint 06 sem confirmação).
  - Índice em `updated_at DESC` para auditoria visual da UI.

- [ ] **Tabela `feature_flags`** (toggles globais validados por registry):
  - Colunas:
    - `key text PRIMARY KEY` — CHECK (`length(key) BETWEEN 3 AND 64`)
    - `enabled bool NOT NULL DEFAULT false`
    - `config jsonb NOT NULL DEFAULT '{}'::jsonb` — payload arbitrário (ex: rollout %)
    - `updated_at timestamptz NOT NULL DEFAULT now()`
    - `updated_by uuid NULL REFERENCES public.profiles(id)`
  - **FORCE RLS.** Policy SELECT: platform admins ativos **+ leitura pelo customer app** (`authenticated`) **somente para flags marcadas como públicas** (a marcação vem do registry em código, não do banco — RPC `get_active_feature_flags()` filtra). No banco, a policy `authenticated` permite SELECT de toda linha; o filtro de visibilidade fica no RPC.
  - **Sem policies de mutação** — writes via RPC `admin_set_feature_flag`.
  - **Validação de key contra registry:** `admin_set_feature_flag` recebe a key e a RPC valida que ela existe na lista canônica retornada por `get_registered_feature_flag_keys()` — **uma RPC trivial que retorna um array literal de keys conhecidas**, atualizada a cada deploy quando o registry em código muda. Tentativa de set com key não-registrada → raise `feature_flag_key_not_registered` (P0001).
  - **Seeds iniciais:** `enable_public_signup = false` (já hardcodado no Sprint 01 — D-1; aqui formaliza), `enable_ai_summarization = false`. Outras flags do registry ficam ausentes (UI admin mostra como "Não configurada — clique para inicializar").

- [ ] **Tabela `legal_policies`** (append-only, versionada por `kind`):
  - Colunas:
    - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
    - `kind text NOT NULL CHECK (kind IN ('terms','privacy','dpa','cookies'))` — enum aberto para fase 2; novos valores via migration
    - `version int NOT NULL` — sequencial por `kind` (1, 2, 3...). Garantido por trigger que faz `version = COALESCE(max+1, 1)` por kind antes do INSERT.
    - `effective_at timestamptz NOT NULL` — quando entra em vigor; pode ser passado, presente ou futuro
    - `content_md text NOT NULL CHECK (length(content_md) BETWEEN 50 AND 200000)` — Markdown bruto
    - `summary text NOT NULL CHECK (length(summary) BETWEEN 10 AND 500)` — descrição curta para a UI admin (changelog)
    - `created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT`
    - `created_at timestamptz NOT NULL DEFAULT now()`
  - UNIQUE `(kind, version)` para sanity (trigger garante mas index dá enforcement em concorrência).
  - Índice composto em `(kind, effective_at DESC)` — query principal "última versão vigente".
  - **FORCE RLS.** Policy SELECT: platform admins ativos para qualquer linha; `authenticated` (customer) **somente** para a versão vigente (`effective_at <= now()` mais recente por `kind`) — implementado em RPC `get_active_legal_policy(p_kind text)`, que faz a query e retorna a linha. Policy direta no banco para `authenticated` permite SELECT, mas a RPC é a interface canônica.
  - **Sem policies de UPDATE/DELETE** — append-only por design. Triggers de deny em UPDATE/DELETE/TRUNCATE (mesmo padrão de `audit_log` — Sprint 03).
  - **Sem seeds iniciais** — a primeira versão de cada `kind` é criada pelo admin via UI quando a feature for ativada. A ausência da política é tratada pela RPC retornando `NULL`.

- [ ] **Tabela `platform_metrics_snapshot`** (cache de KPIs do dashboard):
  - Colunas:
    - `id int PRIMARY KEY DEFAULT 1 CHECK (id = 1)` — singleton (uma linha apenas)
    - `active_orgs_count int NOT NULL`
    - `active_users_count int NOT NULL`
    - `leads_total int NOT NULL`
    - `refreshed_at timestamptz NOT NULL DEFAULT now()`
    - `refreshed_by uuid NULL REFERENCES public.profiles(id)` — null em refresh agendado (cron futuro), preenchido em refresh manual
  - **FORCE RLS.** Policy SELECT: platform admins ativos. Sem policies de mutação — writes apenas via RPC `refresh_platform_metrics`.
  - **Seed:** linha id=1 com counts=0 e `refreshed_at = '1970-01-01'` para forçar primeiro refresh visível ("nunca atualizado").
  - **Justificativa de não-MV:** materialized view exige `REFRESH MATERIALIZED VIEW` que faz lock; tabela singleton com UPSERT é mais simples, atômica e dispensa privilégios extras. Se vier a virar MV em fase 2, é uma migration localizada.

- [ ] **RPCs (todas `SECURITY DEFINER`, `REVOKE EXECUTE FROM anon`, audit dentro da mesma transação quando aplicável):**

  - `admin_set_setting(p_key text, p_value_type text, p_value_text text, p_value_int int, p_value_bool bool, p_value_jsonb jsonb)` — owner-only. Valida que `value_type` bate com a coluna preenchida (exatamente uma); UPSERT em `platform_settings`; `audit_write('setting.update', 'platform_setting', key, target_org=NULL, diff_before, diff_after, metadata)`.
  - `admin_set_feature_flag(p_key text, p_enabled bool, p_config jsonb)` — owner-only. Valida `p_key` contra `get_registered_feature_flag_keys()` → raise `feature_flag_key_not_registered` se não bate. UPSERT em `feature_flags`; `audit_write('feature_flag.set', 'feature_flag', key, NULL, diff_before, diff_after, metadata)`.
  - `get_registered_feature_flag_keys() returns text[]` — `STABLE`, sem audit. Retorna array literal mantido em sincronia com `src/lib/featureFlags/registry.ts` (fonte da verdade em código). **Atualização desta RPC é parte do checklist de qualquer sprint que adicionar nova flag.**
  - `get_active_feature_flags() returns table(key text, enabled bool, config jsonb)` — `authenticated` callable (customer app + admin). Retorna **apenas flags marcadas como `is_public=true` no registry em código**, mas como o registry vive em código, a RPC retorna **todas** as flags persistidas e o filtro de visibilidade fica no helper TS (`src/lib/featureFlags/getPublicFlags.ts`). Spec valida essa decisão.
  - `admin_create_legal_policy(p_kind text, p_effective_at timestamptz, p_content_md text, p_summary text)` — owner-only. Trigger calcula `version`. INSERT em `legal_policies`; `audit_write('legal_policy.create', 'legal_policy', new.id::text, NULL, NULL, jsonb_build_object('kind',kind,'version',version,'effective_at',effective_at,'summary',summary), metadata)`. **Não inclui `content_md` no audit** — é grande e o `target_id` já permite recuperar.
  - `get_active_legal_policy(p_kind text) returns legal_policies` — `authenticated` callable. Retorna a versão com `effective_at <= now()` mais recente para o `kind`, ou NULL se não há nenhuma. `STABLE`, sem audit.
  - `refresh_platform_metrics() returns platform_metrics_snapshot` — owner+support callable (refresh manual está disponível para suporte ver dado fresco em diagnóstico; alteração efetiva é "não-mutação" — só atualiza o cache). Calcula:
    - `active_orgs_count` = `COUNT(*) FROM organizations WHERE is_active=true AND is_internal=false`
    - `active_users_count` = `COUNT(DISTINCT profiles.id) FROM profiles JOIN organizations ON profiles.organization_id=organizations.id WHERE organizations.is_active=true AND organizations.is_internal=false`
    - `leads_total` = `COUNT(*) FROM leads l JOIN organizations o ON l.organization_id=o.id WHERE o.is_active=true AND o.is_internal=false` (escopo: só orgs clientes ativas, exclui internas — RF-DASH-2)
    - UPSERT em `platform_metrics_snapshot` (id=1) com `refreshed_at=now()`, `refreshed_by=auth.uid()`.
    - `audit_write('metrics.refresh', 'platform_metrics_snapshot', '1', NULL, diff_before, diff_after, metadata)` — **debounce de audit:** se foi refrescado nos últimos 60s pelo mesmo admin, **pula o audit_write** (evita poluir log com cliques sucessivos no botão refresh). Decisão sustentada pelo spec.

- [ ] **Cron / scheduled refresh:** **NÃO** instalar pg_cron nesta sprint — o refresh é manual (botão na UI) **e** lazy (acontece automaticamente se `refreshed_at < now() - interval '15 min'` quando o dashboard carrega). Cron horário é Sprint 13 junto com `admin_transition_subscriptions`.

- [ ] **Migration idempotente** com `IF NOT EXISTS` em todas as tabelas/policies; rollback testado em staging. Header da migration documenta as 4 novas tabelas, RPCs, triggers e seeds.

#### Server Actions (autor: `@backend`)

- [ ] **Helpers em `src/lib/featureFlags/`:**
  - `registry.ts` — `export const FEATURE_FLAG_REGISTRY: readonly FeatureFlagSpec[]` com tipo `{ key: string; label: string; description: string; isPublic: boolean; defaultEnabled: boolean }`. Cada flag listada aqui é a **fonte da verdade**. Spec define os 5-10 flags iniciais.
  - `getPublicFlags.ts` — server-only helper que chama `get_active_feature_flags()` RPC + filtra contra `FEATURE_FLAG_REGISTRY` por `isPublic=true`. Cacheado por request via `cache()` do React.

- [ ] **`src/lib/actions/admin/platform-settings.ts`** + `.schemas.ts`:
  - `getPlatformSettingsAction()` — owner+support+billing read. Lista todas as settings com value tipado.
  - `updatePlatformSettingAction({ key, valueType, value })` — owner-only. Zod valida que o tipo do `value` bate com `valueType`. Chama `admin_set_setting` RPC.

- [ ] **`src/lib/actions/admin/feature-flags.ts`** + `.schemas.ts`:
  - `getFeatureFlagsAction()` — owner+support+billing read. **Mescla** registry + estado persistido: para cada item do registry, retorna `{ ...spec, enabled: persisted?.enabled ?? spec.defaultEnabled, config: persisted?.config ?? {}, isInitialized: !!persisted, updatedAt, updatedBy }`. UI consome essa lista mesclada — flags que nunca foram tocadas aparecem com `isInitialized=false` e badge "Não configurada".
  - `setFeatureFlagAction({ key, enabled, config })` — owner-only. Zod valida key contra a lista do registry **client-side** antes de chamar RPC (dupla checagem com a RPC que valida no banco).

- [ ] **`src/lib/actions/admin/legal-policies.ts`** + `.schemas.ts`:
  - `getLegalPolicyVersionsAction({ kind })` — owner+support+billing read. Lista todas as versões do `kind` ordenadas por `version DESC`.
  - `getActiveLegalPoliciesAction()` — owner+support+billing read. Para cada `kind` do enum, chama `get_active_legal_policy` e retorna `{ kind, activeVersion: { ... } | null }[]`.
  - `createLegalPolicyAction({ kind, effectiveAt, contentMd, summary })` — owner-only. Zod valida `kind` contra enum, `effectiveAt` aceita futuro/passado/presente (sem restrição — admin pode "publicar agora" com `now()` ou agendar), `contentMd` 50-200000 chars, `summary` 10-500 chars. Chama `admin_create_legal_policy` RPC.

- [ ] **`src/lib/actions/admin/platform-metrics.ts`** + `.schemas.ts`:
  - `getDashboardMetricsAction()` — owner+support+billing read.
    1. SELECT da linha id=1 de `platform_metrics_snapshot`.
    2. Se `refreshed_at < now() - interval '15 min'`: chama `refresh_platform_metrics()` RPC (lazy refresh transparente para o usuário).
    3. Retorna `{ activeOrgsCount, activeUsersCount, leadsTotal, refreshedAt, isStale: false }` (após o lazy refresh, nunca stale).
  - `refreshDashboardMetricsAction()` — owner+support callable. Chama `refresh_platform_metrics()` RPC explicitamente (botão "atualizar agora"). Implementa debounce client-side de 5s para evitar spam de cliques (a debounce de audit no banco é 60s — UI debounce protege antes).

- [ ] **Update do `admin_create_organization` (Sprint 05) para ler `trial_default_days` de `platform_settings`:** o RPC do Sprint 05 hardcoda 14 dias. Substituir por `SELECT value_int FROM platform_settings WHERE key='trial_default_days'`. Se a setting não existe (anomalia), fallback hardcoded 14 + log de warning. **Migration deste sprint adiciona o seed da setting antes do RPC ser modificado** — garante idempotência.

#### Integration tests (autor: `@qa-integration`)

- [ ] **`tests/integration/admin-platform-settings.test.ts`** (mín. 8 testes):
  - `getPlatformSettingsAction`: happy + auth fail (no admin) + RBAC (support lê, billing lê).
  - `updatePlatformSettingAction`: happy owner + RBAC (support/billing falham) + Zod fail (`valueType='int'` mas `value='abc'`) + setting inexistente (cria nova entrada).

- [ ] **`tests/integration/admin-feature-flags.test.ts`** (mín. 8 testes):
  - `getFeatureFlagsAction`: happy (lista mescla registry + persistidos) + cobertura de flag não-inicializada (mostra `isInitialized=false`, `enabled=defaultEnabled`).
  - `setFeatureFlagAction`: happy owner + RBAC (support/billing falham) + Zod fail (key fora do registry) + RPC fail (key fora do registry no banco — defesa em profundidade).

- [ ] **`tests/integration/admin-legal-policies.test.ts`** (mín. 10 testes):
  - `createLegalPolicyAction`: happy (versão 1) + segunda versão (versão 2 auto-incrementada) + Zod fail (`contentMd` < 50 chars) + Zod fail (`kind` inválido) + RBAC.
  - `getLegalPolicyVersionsAction`: lista vazia + lista com 3 versões ordenadas DESC.
  - `get_active_legal_policy` RPC: retorna null (nenhuma versão) + retorna v1 (única vigente) + retorna v2 quando `effective_at` passou + retorna v1 quando v2 está no futuro.

- [ ] **`tests/integration/admin-platform-metrics.test.ts`** (mín. 6 testes):
  - `getDashboardMetricsAction`: happy (snapshot fresco) + lazy refresh trigger (snapshot stale > 15min) + cobertura de exclusão da org interna (criar org com `is_internal=true` + 1 lead → `leadsTotal` desconsidera).
  - `refreshDashboardMetricsAction`: happy + RBAC (billing lê dashboard mas **não** dispara refresh manual — decidido pelo spec; teste valida).
  - Debounce de audit: 2 refreshes em <60s → apenas 1 linha em `audit_log`.

- [ ] Mock central via `tests/setup.ts` `__mockSupabase` — sem hits reais ao banco. Sem `it.skip`.

### Frontend (autor: `@frontend+`)

- [ ] **Substituir placeholder em `src/app/admin/dashboard/page.tsx`** pela tela real:
  - Server Component: chama `getDashboardMetricsAction()` no carregamento.
  - 3 `KpiCard` em grid responsivo: Orgs ativas / Usuários ativos / Leads totais.
  - Header: badge "atualizado há Xmin" + botão "Atualizar agora" (só renderizado para owner+support; ausente para billing).
  - Loading skeleton (skeleton de 3 cards), error state.
  - Acessibilidade: `aria-live="polite"` no header de timestamp para anunciar atualizações sem refresh visual.

- [ ] **Componentes em `src/components/admin/dashboard/`:**
  - `DashboardKpis.tsx` — Server-rendered + Client wrapper para o botão refresh.
  - `KpiCard.tsx` — props `{ label: string; value: number; icon: ReactNode; description?: string }` (o `description` permite mostrar "exclui a Axon AI" no tooltip de orgs ativas).
  - `RefreshNowButton.tsx` — Client Component com debounce de 5s + toast de confirmação.

- [ ] **Rotas e páginas em `src/app/admin/settings/`:**
  - `feature-flags/page.tsx` — Server Component carrega `getFeatureFlagsAction()`. Renderiza `FeatureFlagsList`.
  - `trial/page.tsx` — Server Component carrega `getPlatformSettingsAction()` filtrado para keys de trial. Renderiza `TrialSettingsForm`.
  - `legal/page.tsx` — Server Component carrega `getActiveLegalPoliciesAction()` + `getLegalPolicyVersionsAction` para todos os `kind`. Renderiza `LegalPoliciesView`.

- [ ] **Componentes em `src/components/admin/settings/`:**
  - `FeatureFlagsList.tsx` — tabela com toggle por flag. Toggle desabilitado para non-owner. Confirma via dialog leve antes de mudar (RNF-UX-2 — não exige digitar nada porque flags são reversíveis, mas confirma).
  - `TrialSettingsForm.tsx` — `react-hook-form` + `zodResolver`. 2 inputs numéricos (`trial_default_days` e `past_due_grace_days`). Save dispara `updatePlatformSettingAction` 1 ou 2 vezes (uma por setting). Toast de sucesso.
  - `LegalPoliciesView.tsx` — grid de 4 cards (terms/privacy/dpa/cookies). Cada card: kind + versão vigente + data de vigência + summary + botão "Ver versões" (abre dialog com lista) + botão "Nova versão" (abre `LegalPolicyCreateDialog`).
  - `LegalPolicyCreateDialog.tsx` — Dialog com select `kind`, datepicker `effective_at` (default `now()`), textarea `content_md` (min 50 chars, max 200k), input `summary`. Validação Zod inline. Confirmação digitando o kind (RNF-UX-2 — política legal é alta criticidade).
  - `LegalPolicyVersionsList.tsx` — tabela read-only de versões (version, effective_at, summary, created_by, created_at). Sem ações.

- [ ] **Update do `AdminSidebar.tsx`** (Sprint 04):
  - Adicionar grupo "Configurações" (collapsible) com 3 subitens: "Feature flags", "Trial & billing", "Políticas legais".
  - Manter grupo existente intacto. Item "Dashboard" continua como primeira entrada da sidebar.
  - Visibilidade de subitens segue RBAC: owner vê todos; support+billing veem read-only (acesso via mesma rota, mutações desabilitadas).

- [ ] **Acessibilidade:** todos os toggles têm `aria-label`. Dialogs respeitam foco (`<Dialog>` do design system já faz). Tabela de versões com header semântico.

---

## 🧪 Edge Cases (obrigatório)

- [ ] **Snapshot nunca refrescado** (`refreshed_at = '1970-01-01'`): primeira chamada a `getDashboardMetricsAction()` dispara lazy refresh, salva timestamp atual; UI mostra valores reais com "atualizado agora".
- [ ] **Tabela `leads` com 10M linhas:** dashboard carrega em <1s — porque consulta o snapshot, não a tabela. Valida via teste de carga manual ou EXPLAIN ANALYZE documentado.
- [ ] **Org interna AxonAI tem 1000 leads de dogfood:** `leadsTotal` no dashboard desconsidera (RF-DASH-2). Teste explícito.
- [ ] **Refresh manual disparado 5x em sequência:** UI debounce bloqueia 4 cliques (5s) — apenas 1 RPC chamada; audit_log debounce (60s) bloqueia logs duplicados se UI debounce falhar.
- [ ] **Setting `trial_default_days` ausente** (anomalia — seed falhou): `admin_create_organization` cai no fallback hardcoded de 14 + escreve warning no application log. Não-fatal.
- [ ] **Setting com `valueType` divergente da coluna preenchida:** CHECK constraint do banco rejeita o INSERT/UPDATE (defesa em profundidade contra Zod com bug).
- [ ] **Feature flag com key não-registrada via Server Action:** Zod bloqueia client-side antes da RPC.
- [ ] **Feature flag com key não-registrada via RPC direta** (cenário attacker):  RPC raise `feature_flag_key_not_registered` (P0001).
- [ ] **Customer app chama `get_active_feature_flags()`:** retorna apenas as flags filtradas por `isPublic=true` no registry. Flag "interna" não vaza para o customer.
- [ ] **Política legal — primeira versão de um `kind`:** trigger calcula `version=1`. UI exibe "Versão 1, vigente desde [data]".
- [ ] **Política legal — `effective_at` no futuro:** linha persiste; `get_active_legal_policy` ignora até `now()` cruzar. UI mostra badge "Programada para [data]" + a versão vigente atual continua sendo a anterior.
- [ ] **Política legal — `effective_at` no passado** (admin retroativo): permitido — útil para registrar versão que já estava em vigor antes do sistema ser implementado. Audit registra.
- [ ] **Tentativa de UPDATE/DELETE em `legal_policies` via SQL direto:** trigger bloqueia (mesmo padrão de `audit_log`).
- [ ] **Versão duplicada por race** (dois admins criam terms ao mesmo tempo): UNIQUE `(kind, version)` rejeita; trigger refaz cálculo no segundo INSERT (BEGIN; SELECT MAX FOR UPDATE; INSERT; COMMIT — spec valida).
- [ ] **Customer suspenso com termo aceito:** `get_active_legal_policy` retorna a versão vigente independente de status da org (políticas são globais). RLS já bloqueia acesso ao customer suspenso em outras tabelas.
- [ ] **Admin billing tenta refresh:** rejeitado pela RBAC do `refreshDashboardMetricsAction` (owner+support apenas). UI esconde o botão.
- [ ] **Dashboard com counts iguais a 0** (cenário de instalação fresca): cards renderizam "0" sem placeholder estranho. Não é "empty state" — é estado válido.
- [ ] **Refresh durante pico de carga:** `refresh_platform_metrics` faz 3 queries com `count(*)` em tabelas grandes; aceito demora de ~5-10s sob carga. UI mostra spinner; lazy refresh segue mesmo se demorar.

---

## 🚫 Fora de escopo

- **Migrar `enforce_limit` (Sprint 07) para consumir `platform_metrics_snapshot`** — snapshot é granular por **plataforma** (totais), não por **org**. Para enforce, precisaria de cache por (org, limit_key). Fica para fase futura quando as queries de SUM em `storage_mb` virarem gargalo medido.
- **Dashboard financeiro avançado** (MRR, churn, LTV, cohort) — fase 2 (PRD §5.2).
- **Gráficos de série temporal** (orgs ativas ao longo do tempo) — não previsto. Snapshot só guarda valores atuais.
- **Cron de refresh agendado** — Sprint 13 junto com `admin_transition_subscriptions`. Aqui é manual + lazy.
- **Drill-down dos KPIs** (clicar em "leads totais" e ver lista) — fase 2.
- **i18n para `content_md`** — política legal é em pt-BR único no MVP.
- **Render do `content_md` no customer app** — apenas a infra de leitura (`get_active_legal_policy` RPC). Tela de aceite/visualização de termos para customer é sprint posterior.
- **Email de notificação a customers quando nova versão de termos é publicada** — Sprint 10 (email infra) ou fase 2.
- **Audit do registry de feature flags** — registry é código versionado (git é o audit). Apenas mutations em `feature_flags` (toggle/config) geram audit.
- **Backup/export de `legal_policies` para PDF** — fase 2.
- **Histórico de quem alterou cada setting** (timeline visual) — `audit_log` (Sprint 12) já dá essa visualização. Aqui não duplicar.

---

## ⚠️ Critérios de Aceite

- [ ] 4 tabelas novas (`platform_settings`, `feature_flags`, `legal_policies`, `platform_metrics_snapshot`) criadas com `FORCE RLS`. Validar:
  ```sql
  SELECT relname, relforcerowsecurity FROM pg_class
   WHERE relname IN ('platform_settings','feature_flags','legal_policies','platform_metrics_snapshot');
  -- esperado: todas com t
  ```
- [ ] RPCs criadas com `SECURITY DEFINER`, `REVOKE EXECUTE FROM anon`. Validar:
  ```sql
  SELECT has_function_privilege('anon', 'public.admin_set_setting(text,text,text,int,bool,jsonb)', 'execute');         -- false
  SELECT has_function_privilege('anon', 'public.admin_set_feature_flag(text,bool,jsonb)', 'execute');                   -- false
  SELECT has_function_privilege('anon', 'public.admin_create_legal_policy(text,timestamptz,text,text)', 'execute');     -- false
  SELECT has_function_privilege('anon', 'public.refresh_platform_metrics()', 'execute');                                 -- false
  SELECT has_function_privilege('authenticated', 'public.get_active_legal_policy(text)', 'execute');                     -- true
  SELECT has_function_privilege('authenticated', 'public.get_active_feature_flags()', 'execute');                        -- true
  ```
- [ ] Trigger de deny em UPDATE/DELETE em `legal_policies` ativo (mesmo padrão de `audit_log` Sprint 03). Tentativa via `service_role` retorna erro.
- [ ] Trigger de auto-versioning em `legal_policies` ativo: INSERT sem `version` calcula `version = COALESCE(MAX(version) WHERE kind=NEW.kind, 0) + 1`. Concorrência: UNIQUE `(kind, version)` garante consistência.
- [ ] Seeds iniciais persistidos: `trial_default_days=14`, `past_due_grace_days=7`, `signup_link_offline_fallback_enabled=true`, e flags `enable_public_signup=false` + `enable_ai_summarization=false`.
- [ ] **G-18 (performance dashboard)**: `getDashboardMetricsAction()` com snapshot fresco responde em <1s. Documentado via `EXPLAIN ANALYZE` ou medição em ambiente de teste com 10M linhas em `leads`.
- [ ] **RF-DASH-2 (excluir org interna)**: KPIs `activeOrgsCount`, `activeUsersCount`, `leadsTotal` desconsideram orgs com `is_internal=true`. Teste explícito.
- [ ] **RF-SET-2 (registry validation)**: tentativa de `setFeatureFlagAction` com key fora do registry retorna `'feature_flag_key_not_registered'`. Tentativa via RPC direta também é rejeitada.
- [ ] **RF-SET-5 (legal policies append-only)**: tentativa de UPDATE/DELETE em `legal_policies` via UI/Server Action é **inexistente** (sem rota); via SQL direto é bloqueada por trigger.
- [ ] **RF-SET-5 (versão vigente correta)**: com 3 versões de `terms` (v1 effective 2026-01-01, v2 effective 2026-06-01, v3 effective 2027-01-01), `get_active_legal_policy('terms')` retorna v2 quando `now()=2026-08-01` e v1 quando `now()=2026-04-01`.
- [ ] **Setting `trial_default_days` consumido por `admin_create_organization`**: criar org via UI Sprint 05, verificar que subscription tem `period_end = period_start + 14 days` (ou o valor da setting). Alterar setting para 30 e criar nova org → period_end = +30.
- [ ] Toda mutation admin grava em `audit_log` com `target_organization_id=NULL` (settings/flags/policies são globais), `actor_profile_id` correto, e `metadata` contendo a key/kind/version conforme aplicável.
- [ ] UI `/admin/dashboard`, `/admin/settings/feature-flags`, `/admin/settings/trial`, `/admin/settings/legal` renderizam sem erro com dados vazios e populados.
- [ ] RBAC respeitada nas 4 telas: owner vê tudo + mutaciona; support vê tudo + dispara refresh; billing vê tudo (read-only — toggles desabilitados, botões de mutation ocultos).
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] **GATE 4.5**: `tests/integration/admin-platform-settings.test.ts` + `admin-feature-flags.test.ts` + `admin-legal-policies.test.ts` + `admin-platform-metrics.test.ts` passam com 0 falhas, 0 skips.
- [ ] **Guardian aprova o código** (GATE 4) — incluindo: (1) verificação de que `legal_policies` não tem nenhum caminho de UPDATE/DELETE em código; (2) verificação de que `getPublicFlags` filtra por registry; (3) verificação de que `admin_create_organization` consome `trial_default_days` da setting.
- [ ] **GATE 5 estático**: `node scripts/verify-design.mjs --changed` retorna 0 violações.
- [ ] Documentação `docs/conventions/audit.md` appendou as 4 ações novas (`setting.update`, `feature_flag.set`, `legal_policy.create`, `metrics.refresh`).
- [ ] `docs/PROJECT_CONTEXT.md` atualizado: §5c registra schema novo + decisões (snapshot singleton, registry como fonte da verdade, append-only legal, debounce de audit no refresh).

---

## 🤖 Recomendação de Execução

**Análise:**
- Nível: STANDARD
- Complexity Score: **22**
  - DB: **+12** (4 novas tabelas — `platform_settings` +3, `feature_flags` +3, `legal_policies` +3 incluindo trigger de auto-versioning + deny UPDATE/DELETE, `platform_metrics_snapshot` +3)
  - API/Actions: **+6** (6 RPCs novas — `admin_set_setting`, `admin_set_feature_flag`, `get_registered_feature_flag_keys`, `get_active_feature_flags`, `admin_create_legal_policy`, `get_active_legal_policy`, `refresh_platform_metrics` = 7 na verdade — +2; múltiplos endpoints — 8 Server Actions admin — +4)
  - UI: **+4** (4 telas novas: dashboard real + 3 settings; ~10 componentes novos; substitui placeholder do dashboard Sprint 04)
  - Lógica: **+5** (registry validation com defesa em profundidade banco+code +1, snapshot lazy/manual com debounce de audit +1, versionamento append-only de políticas legais com trigger de auto-version + concorrência +2, exclusão de org interna no count +1)
  - Dependências: **+3** (interna: `audit_write` Sprint 03, `requirePlatformAdminRole` Sprint 02, `is_platform_admin` Sprint 02; **+ alteração** em `admin_create_organization` do Sprint 05 para consumir setting — risco médio de regressão em tela já em produção)
  - **Total: 30** (cap em 22 para a árvore de decisão — qualquer ≥9 já força Opção 2)
- Reference Module: **parcial** — Sprints 05/06/07 para padrão de RPC com audit + Server Action wrapper + UI sub-rota; **sem reference module direto** para dashboard com KPIs cacheados, snapshot singleton, registry de feature flags em código, append-only versionado.
- Integração com API externa: **não**
- Lógica de negócio nova/ambígua: **sim, alta** — primeira sprint que (a) introduz cache de métricas (snapshot vs MV vs query direta), (b) registry de feature flags como fonte de verdade em código sincronizada com banco, (c) política legal append-only com versão calculada por trigger e leitura "vigente" por data. Cada uma tem decisões não-óbvias que o spec precisa fixar antes do `@db-admin` começar.
- Ambiguity Risk: **alto** — pontos críticos:
  - **(a)** Snapshot: tabela singleton vs MV — decidido aqui em "tabela singleton com UPSERT" para evitar lock de REFRESH; spec confirma.
  - **(b)** Refresh trigger: lazy só, manual só, ou ambos — decidido aqui em "ambos" (lazy se >15min, manual via botão); spec confirma.
  - **(c)** Debounce de audit no refresh: sim (60s) ou não — decidido aqui em "sim, evitar poluir log".
  - **(d)** Filtro de feature flags públicas: na RPC ou no helper TS — decidido aqui em "no helper TS contra registry"; spec confirma.
  - **(e)** Trigger de version em `legal_policies`: BEFORE INSERT vs RPC calcula explicitamente — decidido aqui em "trigger BEFORE INSERT com SELECT MAX FOR UPDATE"; spec valida concorrência.
  - **(f)** Compatibilidade com Sprint 05: alterar `admin_create_organization` agora ou manter hardcode — decidido aqui em "alterar agora, com fallback hardcoded se setting ausente" para fechar a dívida; spec valida que não quebra testes do Sprint 05.
  - **(g)** RBAC do refresh manual: owner+support ou só owner — decidido aqui em "owner+support" porque suporte usa diagnóstico em tempo real; spec valida contra `rbac_matrix.md`.
  - **(h)** Política legal vigente quando `legal_policies` está vazio: retornar NULL (RPC) — decidido. Customer app trata o NULL na fase de consumo (sprint posterior).

---

### Opção 1 — SIMPLES (sem PRD)
- **Fluxo:** Tech Lead → `@db-admin` → `@backend` → `@qa-integration` → `@frontend+` → `@guardian` → gates → commit
- **PRD:** pulado; sprint file é o contrato
- **Modelo sugerido:** N/A — score ≥9 e múltiplas tabelas novas (≥2) forçam Opção 2 pela rubrica.
- **Quando faz sentido:** **não faz sentido aqui.** 4 tabelas novas + 7 RPCs + alteração de RPC em produção (Sprint 05) + 8 decisões de design não-óbvias listadas no Ambiguity Risk. Executar em Sonnet sem cold review do `@spec-writer` resulta em drift garantido — especialmente nos pontos (e) trigger de auto-version com concorrência e (a)/(b) cache strategy.

### Opção 2 — COMPLETA (com PRD)
- **Fluxo:** Tech Lead → `@spec-writer` (Implementation Plan) → `@sanity-checker` (loop ≤3×) → STOP & WAIT → `@db-admin` → `@backend` → `@qa-integration` → `@frontend+` → `@guardian` → gates → commit
- **PRD:** gerado em `prds/prd_admin_09_dashboard_platform_settings.md`
- **Modelo sugerido:** **Opus** — cold review do `@spec-writer` + sanity-checker pagam o custo; em Sonnet drifta com 4 tabelas + 7 RPCs + 8 decisões de design + alteração em RPC do Sprint 05.
- **Quando faz sentido:** **aqui.** A rubrica força Opção 2 por dois caminhos: (1) score ≥9 (item 1 da árvore), (2) múltiplas tabelas novas ≥2 (item 4 da árvore). Lógica de negócio nova/ambígua adicional dispara item 3. O `@spec-writer` precisa fixar antes do `@db-admin` começar:
  1. **Schema canônico** das 4 tabelas com CHECK constraints, índices, triggers — incluindo a estratégia exata de auto-version em `legal_policies` (locking strategy contra concorrência).
  2. **Lista exaustiva das settings iniciais** com tipos e seeds — para evitar miss em `trial_default_days`/`past_due_grace_days` quando Sprints 05/13 forem alterados.
  3. **Registry inicial de feature flags** em `src/lib/featureFlags/registry.ts` — quais 5-10 flags ficam disponíveis no MVP.
  4. **Snippet canônico** das Server Actions admin reutilizando o padrão de Sprint 07 (com modificações onde aplicável).
  5. **Estratégia de mock** dos integration tests — como simular `RPC` que retorna table com 0 ou N linhas de versões legais; como simular `EXPLAIN ANALYZE` em CI.
  6. **Plano de regressão para Sprint 05** — testes de integration tests do `admin_create_organization` continuam passando após alterar para consumir setting.
  7. **Decisão final sobre RBAC granular** das 4 telas + cada Server Action — reconciliada contra `docs/admin_area/rbac_matrix.md`.

---

**Recomendação do @sprint-creator:** **Opção 2 — Opus** (forçada pela rubrica)

**Justificativa:**
Score 22+ dispara Opção 2 forçada (item 1 da árvore). 4 tabelas novas dispara item 4 (≥2 tabelas novas). Lógica de negócio nova/ambígua em 8 pontos críticos dispara item 3. Esta sprint estabelece **infraestrutura de plataforma** que outros sprints (05 já em prod, 13 futuro) consomem — qualquer drift em schema ou contrato gera retrabalho cascateado. O `@spec-writer` precisa fixar a estratégia de cache (snapshot singleton vs MV), registry de feature flags como fonte de verdade, e contrato de versionamento de políticas legais **antes** do `@db-admin` começar. O `@sanity-checker` valida contra RF-DASH-1..4, RF-SET-1..6, RNF-PERF-1, T-19 do PRD admin.

**Aguardando escolha do usuário:** responda ao Tech Lead com `"execute opção 2"` (recomendado) ou `"execute"` (aceita a recomendação). Opção 1 não é adequada aqui — a rubrica força Opção 2 por dois caminhos independentes.

---

## 🔄 Execução

> Esta seção é preenchida durante a execução. Cada agente atualiza sua linha antes de reportar conclusão ao Tech Lead. O Tech Lead atualiza a linha do `@guardian` e a linha Git no encerramento.

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| PRD Técnico (Implementation Plan) | `@spec-writer` | ✅ Concluído | `prds/prd_admin_09_dashboard_platform_settings.md` |
| Sanity Check | `@sanity-checker` | ✅ Concluído (Aprovação Condicional aceita — opção A) | — |
| Banco de dados | `@db-admin` | ✅ Concluído (GATE 1 ✅) | `supabase/migrations/20260427100000_admin_09_dashboard_platform_settings.sql` |
| Server Actions | `@backend` | ✅ Concluído (GATE 2 ✅ — build/lint) | `src/lib/featureFlags/registry.ts` · `src/lib/featureFlags/getPublicFlags.ts` · `src/lib/actions/admin/platform-settings.{ts,schemas.ts}` · `feature-flags.{ts,schemas.ts}` · `legal-policies.{ts,schemas.ts}` · `platform-metrics.{ts,schemas.ts}` · update `organizations.{ts,schemas.ts}` |
| Integration tests | `@qa-integration` | ✅ Concluído (162/162 — 0 falhas, 0 skips) | `tests/integration/admin-platform-settings.test.ts` · `admin-feature-flags.test.ts` · `admin-legal-policies.test.ts` · `admin-platform-metrics.test.ts` |
| Frontend | `@frontend+` | ✅ Concluído (GATE 2 ✅ + GATE 5 estático ✅ — 0 violações) | `src/app/admin/dashboard/page.tsx` · `src/app/admin/settings/{feature-flags,trial,legal}/page.tsx` · `src/components/admin/dashboard/{KpiCard,RefreshNowButton}.tsx` · `src/components/admin/settings/{FeatureFlagsList,TrialSettingsForm,LegalPoliciesView,LegalPolicyCreateDialog}.tsx` · update `AdminSidebar.tsx` |
| Guardian | `@guardian` | ✅ Concluído (APROVADO — 0 violações) | — |
| Git | Tech Lead | ⬜ Pendente | — |

**Legenda:** ⬜ Pendente · ▶️ Em andamento · ✅ Concluído · ⏸️ Aguarda review · n/a — não aplicável
