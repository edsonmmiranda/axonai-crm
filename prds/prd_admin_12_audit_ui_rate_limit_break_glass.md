# PRD: Audit Log UI + Rate Limit Login Admin + Break-Glass CLI

**Template:** PRD_COMPLETE
**Complexity Score:** 22 (cap em 22 — ≥9 força COMPLETE; +integração API externa, +lógica nova/ambígua em 10 pontos, +CLI fora do app)
**Sprint:** admin_12
**Created:** 2026-04-28
**Status:** Draft (aguardando @sanity-checker)

---

## 0. Decisões resolvidas (os 10 pontos de ambiguidade do sprint file)

> Sprint file listou 10 decisões de design abertas. Todas resolvidas aqui — `@db-admin`/`@backend`/`@frontend+` lêem **só este PRD**, sem precisar revisitar o sprint file para escolhas.

**(a) Atomicidade da contagem de rate limit:** **snapshot sem `FOR UPDATE`**, tolerância documentada. `count_admin_login_failures` retorna contagem livre de lock; janela de race entre `count` e `signInWithPassword` é ~10ms. 5 sessões paralelas em ataque coordenado podem registrar 9-10 falhas antes do limite triggerar — **aceitável** para MVP porque (1) atacante humano com 5 abas é raro; (2) atacante automatizado bate Supabase Auth direto (bypassa nosso wrapper) e cai no rate limit do projeto Supabase; (3) `FOR UPDATE` em janela móvel adiciona contention sem fechar o gap (a row da próxima tentativa nem existe ainda). **Não** usar `SERIALIZABLE`. **Não** usar `pg_advisory_lock` por email — custo > benefício no MVP. Documentar trade-off em `docs/admin_area/runbook_break_glass.md` §"Limites de proteção".

**(b) Failure mode dos hooks de login:** **assimétrico — assert fail-closed, record fail-open.**
- `assertAdminLoginRateLimit()`: se `count_admin_login_failures` lança erro de DB → throw `RateLimitError('rate_limit_db_unavailable')` → Server Action retorna erro genérico "Sistema indisponível, tente em alguns minutos." e **não** chama `signInWithPassword`. Defesa: DB indisponível durante incidente não é janela aberta para brute force.
- `recordAdminLoginAttempt()`: se RPC falha → log `console.error` + retorna void (não throw). Defesa oposta: DB falha pós-login não deve invalidar a sessão recém-criada do usuário legítimo (usability > log perdido pontual).
- Documentar comportamento em comentário JSDoc da função e em `runbook_break_glass.md`.

**(c) Onde armazenar o hash do `BREAK_GLASS_SECRET`:** **`platform_settings` row com `key='break_glass_secret_hash'`, `value_type='text'`, `value_text=<sha256_hex>`.** Justificativa: setting já é o lugar canônico para parâmetros operacionais (Sprint 09); rotação via SQL no Studio sem deploy. CLI lê via RPC dedicada `get_break_glass_secret_hash()` (SECURITY DEFINER, GRANT só para `service_role`) — **não** via `SELECT` direto da tabela (evita leak via mais um ponto de RLS). Setup inicial: runbook documenta o SQL one-shot pelo Studio antes do primeiro uso.

**(d) Atomicidade do break-glass entre RPC e Auth Admin API:** **idempotência em ambos os lados; ordem RPC → Auth Admin API; sem compensação.**
- Etapa 1 (RPC `break_glass_recover_owner`): UPSERT em `platform_admins` (idempotente — se já owner ativo, não-op no estado mas grava 2ª linha de audit, eventos não-merged) + `UPDATE profiles SET mfa_reset_required=true` + `audit_write`. Tudo em **uma transação SQL**.
- Etapa 2 (Auth Admin API): `auth.admin.mfa.listFactors` + iteração com `auth.admin.mfa.deleteFactor` para cada factor (TOTP verified+unverified). Idempotente — rerun com lista vazia é no-op.
- Falha parcial (RPC sucede, Auth API falha): rerun manual do CLI (mesmo comando) é seguro; estado convergente. Documentar no runbook §"Recuperação de erro parcial".

**(e) Sessões existentes durante break-glass:** **não revogar; mitigado pelo middleware Sprint 11.** Supabase não expõe API trivial para revogar refresh tokens via JS Admin API; tentar via SQL (`DELETE FROM auth.refresh_tokens WHERE user_id=...`) é não-suportado oficialmente e quebra com upgrades do Auth. Defesa: middleware `requireAdminSession` (Sprint 04+11) lê `mfa_reset_required` em **cada request** — sessão antiga válida cai em redirect para `/admin/mfa-enroll?reenroll=true` no próximo refresh (TTL admin=8h, default Supabase refresh=1h). Janela máxima de exposição: 1h. Documentar no runbook como aceito.

**(f) Filtragem RBAC para billing — regex SQL canônica:** **`action ~ '^(plan|subscription|grant|org)\.'`** (4 prefixos exatos). Validado contra `docs/admin_area/rbac_matrix.md` linha 82 ("R (escopo billing apenas)") + cruzamento com `actionRegistry.ts` (§3.5 deste PRD). billing **não vê**: `inspect.*` (read sensível de cliente), `platform_admin.*` (gestão de operadores), `password_reset.*` (auth), `auth.*` (login), `settings.*`/`feature_flag.*`/`legal_policy.*`/`integration_credential.*` (config global), `email.*` (delivery), `metrics.*` (snapshots), `break_glass.*` (recuperação).

**(g) Renderer de diff:** **componente custom `<DiffTable>` ~80 linhas TSX, sem dep externa.** Recebe `{ before: Record<string, unknown> | null, after: Record<string, unknown> | null }` shallow JSON (deep nesting é raro nos slugs em uso). Layout: 3 colunas (Campo, Antes, Depois). Comparação de chaves por união (`Object.keys(before ?? {}) ∪ Object.keys(after ?? {})`). Ênfase visual em campos onde `before[k] !== after[k]` via borda colorida (token semântico `border-feedback-warning-border` para alterado). Creation event (`before === null`) → renderiza `<JsonView after>`; deletion (`after === null`) → mesmo com `before`. Sem dep nova (`react-diff-viewer-continued` adiciona ~30KB e overkill).

**(h) Performance da query do audit:** **índices existentes do Sprint 03 cobrem; não criar novos.** `audit_log` já tem 4 índices (verificado live via MCP 2026-04-28):
- `audit_log_occurred (occurred_at DESC)` — ordenação default + paginação keyset.
- `audit_log_action_occurred (action, occurred_at DESC)` — filtro por action.
- `audit_log_actor_occurred (actor_profile_id, occurred_at DESC) WHERE actor_profile_id IS NOT NULL` — filtro por admin.
- `audit_log_target_org_occurred (target_organization_id, occurred_at DESC) WHERE target_organization_id IS NOT NULL` — filtro por org alvo.
Filtro por `target_type` sozinho é raro (sempre combinado com action+período); cobertura é via `audit_log_occurred` + filter na execução. **`@db-admin` não cria índice novo em `audit_log`**. Validação no GATE 4.5: integration test inclui `EXPLAIN (ANALYZE, BUFFERS)` em query representativa com 100k linhas seedadas para confirmar `<500ms` p95.

**(i) Timezone no filtro de período:** **input/display em TZ do navegador; storage/query em UTC; tooltip com timestamp absoluto UTC em cada linha.** UI converte input do usuário (date picker) para ISO UTC ao enviar para Server Action. Coluna `Quando` na tabela mostra texto relativo ("há 2h"); tooltip ao hover exibe `2026-04-28T14:32:11Z` (UTC ISO). Sem banner de "horário em UTC" — o tooltip é a fonte de verdade.

**(j) Cardinalidade do autocomplete de ator:** **10 resultados, ORDER BY mais recente, premissa A-2 (<10 admins ativos no MVP).** `searchAuditActorsAction(query, limit=10)` ordena por `MAX(occurred_at) DESC` agrupado por `actor_profile_id`. Se equipe Axon crescer >10 admins, paginar é fase 2. Documentado no fora-de-escopo deste sprint.

**Bonus — Decisão D-7 (retenção de audit_log):** **MVP retém indefinidamente; coluna `retention_expires_at` reservada; defaults sugeridos para fase 2: 7 anos compliance / 90 dias `inspect.*` / 1 ano `auth.*` / indefinido `break_glass.*`.** Documentado em `PROJECT_CONTEXT.md` §3 D-7 ao final deste sprint. Purge job com `WHERE retention_expires_at < now()` é fase 2 (exige bypass dos triggers `audit_log_deny_*` via função SECURITY DEFINER dedicada).

---

## 1. Overview

### Business Goal

Fechar a malha de **observabilidade operacional + recuperação de emergência** da plataforma admin. Hoje (pós Sprint 11) todo o corpus de ações sensíveis grava em `audit_log` na mesma transação, mas:
- **Sem UI de visualização** — investigação de incidente exige SQL direto no Studio.
- **Sem rate limit no `/admin/login`** — Server Action de login falha-aberto contra brute force; única defesa é o limite default do Supabase Auth (não auditável).
- **Sem procedimento formal de recuperação** se último owner for desativado por engano OU todos os admins perderem MFA simultaneamente (T-14, T-20).

Sprint 12 entrega: (1) `/admin/audit` listagem+detalhe paginado com filtros e RBAC; (2) `login_attempts_admin` + middleware sliding-window 5/email + 20/IP em 10min; (3) CLI `scripts/break-glass.ts` com double-key (service role + secret hash em settings) + audit obrigatório.

### User Stories (consolidadas do sprint file §"User Stories")

- Owner/support filtra audit por admin/ação/organização/período em `<500ms` (RNF-PERF-2).
- Billing vê audit filtrado server-side para slugs comerciais (`plan.*|subscription.*|grant.*|org.*`).
- Auditor abre detalhe de uma linha e vê diff JSON pretty-printed com campos alterados destacados.
- Time SRE vê 6ª tentativa de login do mesmo email em 10min ser rejeitada com mensagem genérica.
- Operador de incidente em lockout total roda `tsx scripts/break-glass.ts <email>` com env válida + confirmação digitada → owner restaurado + MFA invalidado + audit gravado.
- CLI rejeita execução sem `BREAK_GLASS_SECRET` antes de qualquer write no banco.

### Success Metrics (binários)

- **G-13 email scope:** 6ª chamada a `signInAdminAction` com mesmo email em <10min retorna erro genérico + linha em `audit_log` com `action='auth.login_rate_limited'` + `metadata.scope='email'`.
- **G-13 IP scope:** 21ª chamada do mesmo IP contra emails distintos em <10min retorna 429 + audit `scope='ip'`.
- **G-21 fail-closed:** rodar CLI sem `BREAK_GLASS_SECRET` falha **antes** de qualquer write (validável via `count(*) FROM audit_log WHERE action='break_glass.recover_owner'` antes/depois — mesmo número).
- **G-21 happy path:** env válida + confirmação correta cria/atualiza `platform_admins` row owner ativo + seta `profiles.mfa_reset_required=true` + 1 linha audit `break_glass.recover_owner`.
- **RBAC billing:** integration test mocka session `role='billing'` e assert que query SQL contém regex `^(plan|subscription|grant|org)\.`.
- **Performance:** integration test seeda 100k linhas + assert `EXPLAIN ANALYZE` p95 `<500ms` para listagem default + filtros principais.
- **Audit append-only revalidado:** tentar `UPDATE audit_log SET action='X' WHERE id=...` via service_role retorna erro do trigger existente (Sprint 03).
- **3 action slugs novos no `audit_log`:** `auth.login_admin_success`, `auth.login_rate_limited`, `break_glass.recover_owner`.

---

## 2. Database Requirements

> **Estado vivo confirmado via MCP** (2026-04-28):
> - `audit_log` colunas atuais: `id, occurred_at, actor_profile_id, actor_email_snapshot, action, target_type, target_id, target_organization_id, diff_before, diff_after, ip_address, user_agent, metadata` — **sem** `retention_expires_at`.
> - `audit_log` índices: `pkey`, `audit_log_occurred (occurred_at DESC)`, `audit_log_action_occurred (action, occurred_at DESC)`, `audit_log_actor_occurred (actor_profile_id, occurred_at DESC) WHERE actor_profile_id IS NOT NULL`, `audit_log_target_org_occurred (target_organization_id, occurred_at DESC) WHERE target_organization_id IS NOT NULL`.
> - `audit_log` triggers ativos: `audit_log_deny_truncate` (BEFORE TRUNCATE), `audit_log_deny_update_delete` (BEFORE DELETE OR UPDATE) — **G-10 já enforced**.
> - `audit_write(action, target_type, target_id, target_organization_id, diff_before, diff_after, metadata, ip_address, user_agent)` SECURITY DEFINER `search_path=public` — **9 args**.
> - `is_platform_admin(target_profile_id uuid)` SECURITY DEFINER `search_path=public` — retorna row de `platform_admins` ou nada.
> - `admin_set_setting(p_key, p_value_type, p_value_text, p_value_int, p_value_bool, p_value_jsonb, p_ip_address, p_user_agent)` SECURITY DEFINER — usado para seed do hash break-glass.
> - Extensions: `pgcrypto v1.3` (digest disponível), `supabase_vault v0.3.1`.
> - `login_attempts_admin` **não existe** (criado neste sprint).

### New Tables

#### `public.login_attempts_admin` — registro de tentativas de login admin

**Justificativa para sem `organization_id`:** evento pré-autenticação (admin ainda não identificado quando login falha; mesmo no sucesso o evento é da plataforma, não do tenant). Adicionar à tabela de exceções em `docs/PROJECT_CONTEXT.md` §2 (não em `standards.md` — APRENDIZADO 2026-04-19 — `standards.md` é overwritten em "Atualizar framework").

**Schema canônico:**

```sql
create extension if not exists pgcrypto;  -- já instalado v1.3; idempotente

create table if not exists public.login_attempts_admin (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  email_hash      bytea not null,                                            -- digest(lower(email),'sha256') derivado pela RPC
  ip_address      inet not null,
  user_agent      text null,
  success         boolean not null,
  occurred_at     timestamptz not null default now(),
  metadata        jsonb null default '{}'::jsonb,

  constraint laa_email_format check (length(email) between 3 and 320 and email = lower(email)),
  constraint laa_user_agent_length check (user_agent is null or length(user_agent) <= 500)
);

create index if not exists laa_email_occurred_idx on public.login_attempts_admin (email, occurred_at desc);
create index if not exists laa_ip_occurred_idx    on public.login_attempts_admin (ip_address, occurred_at desc);
create index if not exists laa_occurred_idx       on public.login_attempts_admin (occurred_at desc);
-- Índice em email_hash NÃO criado: hash é apenas para audit referenciar email sem armazenar plaintext;
-- queries de rate limit filtram por email plain (índice composto já cobre).

alter table public.login_attempts_admin enable row level security;
alter table public.login_attempts_admin force row level security;

create policy "laa_select_owner_support" on public.login_attempts_admin
  for select using (
    exists (
      select 1 from public.platform_admins pa
       where pa.profile_id = auth.uid()
         and pa.is_active = true
         and pa.role in ('owner','support')
    )
  );
-- Sem policies de mutação — writes via RPC SECURITY DEFINER (record_admin_login_attempt).
-- billing NÃO lê (rbac_matrix linha 83).
```

### Modified Tables

#### `public.audit_log` — adicionar coluna `retention_expires_at`

```sql
alter table public.audit_log
  add column if not exists retention_expires_at timestamptz null;

-- Sem default (NULL = retenção indefinida).
-- Sem trigger de set automático no MVP — D-7 fixado como "MVP indefinido"; purge é fase 2.
-- Sem índice em retention_expires_at no MVP — adicionar quando purge job for criado (fase 2).
```

**Validação pós-migration:**
```sql
select column_name from information_schema.columns
 where table_schema='public' and table_name='audit_log' and column_name='retention_expires_at';
-- esperado: 1 linha
```

### Existing Tables Used

#### `public.platform_admins`
- **Usado por**: `break_glass_recover_owner` (UPSERT garante owner ativo), `searchAuditActorsAction` (resolução de admin para autocomplete), policy SELECT em `login_attempts_admin`.
- **Campos acessados**: `profile_id`, `role`, `is_active`, `created_by`.

#### `public.profiles`
- **Usado por**: `break_glass_recover_owner` (`UPDATE profiles SET mfa_reset_required=true`), `searchAuditActorsAction` (lookup de email/nome via JOIN com `audit_log.actor_profile_id`).
- **Campos acessados**: `id`, `email`, `mfa_reset_required` (modificado por Sprint 11).

#### `public.audit_log`
- **Usado por**: 4 Server Actions de leitura (`listAuditLogAction`, `getAuditLogEntryAction`, `searchAuditActorsAction`, `getAuditActionRegistryAction` — registry é estático, não consulta DB), 1 wrapper `audit_login_admin_event` (insert via `audit_write` existente).
- **Campos acessados (leitura)**: todos. **Mutação**: nenhuma direta — sempre via `audit_write` SECURITY DEFINER existente.

#### `public.platform_settings`
- **Usado por**: `get_break_glass_secret_hash()` (read do hash) + `admin_set_setting('break_glass_secret_hash', ...)` (seed manual via runbook).

#### `auth.users` + `auth.mfa_factors`
- **Usado por**: CLI break-glass (Auth Admin API: `auth.admin.listUsers`, `auth.admin.mfa.listFactors`, `auth.admin.mfa.deleteFactor`).

---

## 3. API Contract

### 3.1 RPCs — todas `SECURITY DEFINER`, `SET search_path=public`, `REVOKE EXECUTE FROM public, anon, authenticated`, `GRANT EXECUTE TO service_role` (APRENDIZADO 2026-04-24)

#### `record_admin_login_attempt(p_email text, p_ip inet, p_user_agent text, p_success boolean) RETURNS void`

```sql
create or replace function public.record_admin_login_attempt(
  p_email      text,
  p_ip         inet,
  p_user_agent text,
  p_success    boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.login_attempts_admin (email, email_hash, ip_address, user_agent, success)
  values (lower(p_email), digest(lower(p_email), 'sha256'), p_ip, nullif(left(p_user_agent, 500), ''), p_success);
end;
$$;

revoke execute on function public.record_admin_login_attempt(text, inet, text, boolean) from public, anon, authenticated;
grant execute on function public.record_admin_login_attempt(text, inet, text, boolean) to service_role;
```

**Sem audit row.** Tabela `login_attempts_admin` é o registro próprio — slugs do `audit_log` são reservados para eventos de produto, não tentativas de auth (volume).

#### `count_admin_login_failures(p_email text, p_ip inet, p_window interval) RETURNS jsonb`

```sql
create or replace function public.count_admin_login_failures(
  p_email  text,
  p_ip     inet,
  p_window interval
) returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'by_email', count(*) filter (where email = lower(p_email) and success = false),
    'by_ip',    count(*) filter (where ip_address = p_ip and success = false)
  )
  from public.login_attempts_admin
  where occurred_at > now() - p_window;
$$;

revoke execute on function public.count_admin_login_failures(text, inet, interval) from public, anon, authenticated;
grant execute on function public.count_admin_login_failures(text, inet, interval) to service_role;
```

**STABLE** — query é determinística dentro de uma transação. **Sem `FOR UPDATE`** (decisão (a)).

#### `audit_login_admin_event(p_email text, p_ip inet, p_user_agent text, p_action text, p_metadata jsonb) RETURNS uuid`

```sql
create or replace function public.audit_login_admin_event(
  p_email      text,
  p_ip         inet,
  p_user_agent text,
  p_action     text,
  p_metadata   jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email_hash text;
  v_actor_id   uuid;
  v_audit_id   uuid;
begin
  if p_action not in ('auth.login_admin_success', 'auth.login_rate_limited') then
    raise exception 'invalid_action: %', p_action using errcode = 'P0001';
  end if;

  v_email_hash := encode(digest(lower(p_email), 'sha256'), 'hex');

  -- Resolução de actor_profile_id é best-effort: só preenche em sucesso.
  if p_action = 'auth.login_admin_success' then
    select id into v_actor_id
      from public.profiles
     where lower(email) = lower(p_email)
     limit 1;
  end if;

  -- audit_write existente (Sprint 03) faz INSERT em audit_log + retorna id via OUT inferido.
  -- Como audit_write retorna void, fazemos chamada e capturamos id em SELECT separado se necessário.
  -- Spec valida: se vale modificar audit_write para RETURN id, ou refazer INSERT manual aqui.
  -- Recomendação: chamar audit_write existente (preserva contrato) e retornar lastval()-equivalent não é possível;
  -- alternativa: fazer INSERT direto em audit_log (legítimo dentro de SECURITY DEFINER + RPC controlada).
  insert into public.audit_log (
    actor_profile_id, actor_email_snapshot, action, target_type, target_id, target_organization_id,
    diff_before, diff_after, ip_address, user_agent, metadata
  ) values (
    v_actor_id, lower(p_email), p_action, 'auth_session', null, null,
    null, null, p_ip, nullif(left(p_user_agent, 500), ''),
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('email_hash', v_email_hash)
  )
  returning id into v_audit_id;

  return v_audit_id;
end;
$$;

revoke execute on function public.audit_login_admin_event(text, inet, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.audit_login_admin_event(text, inet, text, text, jsonb) to service_role;
```

**Decisão técnica:** RPC faz `INSERT` direto em `audit_log` (em vez de chamar `audit_write` wrapper) para retornar o `id` da linha inserida — útil para o caller ter referência em logs estruturados. Triggers de deny `audit_log_deny_update_delete` continuam protegendo contra mutação subsequente. Aceitável dentro de função `SECURITY DEFINER` controlada.

#### `get_break_glass_secret_hash() RETURNS text`

```sql
create or replace function public.get_break_glass_secret_hash()
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_hash text;
begin
  select value_text into v_hash
    from public.platform_settings
   where key = 'break_glass_secret_hash'
     and value_type = 'text';
  return v_hash;  -- pode ser NULL se setting não está seedado
end;
$$;

revoke execute on function public.get_break_glass_secret_hash() from public, anon, authenticated;
grant execute on function public.get_break_glass_secret_hash() to service_role;
```

#### `break_glass_recover_owner(p_email text, p_operator text, p_origin_host text) RETURNS jsonb`

```sql
create or replace function public.break_glass_recover_owner(
  p_email       text,
  p_operator    text,
  p_origin_host text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id    uuid;
  v_admin_id      uuid;
  v_was_active    boolean;
  v_old_role      text;
  v_audit_id      uuid;
begin
  if p_email is null or length(p_email) = 0 then
    raise exception 'email_required' using errcode = 'P0001';
  end if;
  if p_operator is null or length(p_operator) = 0 then
    raise exception 'operator_required' using errcode = 'P0001';
  end if;

  -- 1. Localizar profile pelo email
  select id into v_profile_id
    from public.profiles
   where lower(email) = lower(p_email)
   limit 1;

  if v_profile_id is null then
    raise exception 'profile_not_found' using errcode = 'P0001';
  end if;

  -- 2. UPSERT em platform_admins. Não há partial unique em (profile_id) — mas há a regra de
  -- negócio "1 entry ativo por profile" via convenção. Estratégia: SELECT FOR UPDATE primeiro;
  -- se existe linha (ativa ou desativada), UPDATE; senão INSERT.
  select id, is_active, role into v_admin_id, v_was_active, v_old_role
    from public.platform_admins
   where profile_id = v_profile_id
   for update;

  if v_admin_id is null then
    insert into public.platform_admins (profile_id, role, is_active, created_by)
    values (v_profile_id, 'owner', true, v_profile_id)
    returning id into v_admin_id;
  else
    update public.platform_admins
       set role = 'owner',
           is_active = true,
           deactivated_at = null
     where id = v_admin_id;
  end if;

  -- 3. Forçar re-enroll de MFA no próximo login (consumido pelo middleware Sprint 11)
  update public.profiles
     set mfa_reset_required = true
   where id = v_profile_id;

  -- 4. Audit row na MESMA transação (INV-10)
  insert into public.audit_log (
    actor_profile_id, actor_email_snapshot, action, target_type, target_id, target_organization_id,
    diff_before, diff_after, ip_address, user_agent, metadata
  ) values (
    v_profile_id,
    lower(p_email),
    'break_glass.recover_owner',
    'profile',
    v_profile_id,
    null,
    case when v_admin_id is null then null
         else jsonb_build_object('was_active', v_was_active, 'role', v_old_role) end,
    jsonb_build_object('is_active', true, 'role', 'owner'),
    null,
    'cli/break-glass.ts',
    jsonb_build_object(
      'operator', p_operator,
      'origin_host', p_origin_host,
      'platform_admin_id', v_admin_id,
      'restored_role', 'owner'
    )
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'profile_id', v_profile_id,
    'platform_admin_id', v_admin_id,
    'audit_log_id', v_audit_id,
    'was_active', v_was_active,
    'old_role', v_old_role
  );
end;
$$;

revoke execute on function public.break_glass_recover_owner(text, text, text) from public, anon, authenticated;
grant execute on function public.break_glass_recover_owner(text, text, text) to service_role;
```

**Decisões inline:**
- **`SELECT FOR UPDATE`** previne race em break-glass paralelo — improbable mas barato.
- **`actor_profile_id` = profile alvo**: em break-glass, o "ator" é o operador externo (não tem profile no sistema); usamos o profile alvo como referência, com `metadata.operator` capturando a identidade humana.
- **Trigger Sprint 02 `prevent_last_owner_deactivation`**: NÃO interfere — `break_glass_recover_owner` apenas ATIVA owners, não desativa.
- **MFA factor invalidation NÃO acontece dentro do RPC** — é chamada Auth Admin API JS feita pelo CLI após o RPC retornar (decisão (d)).

### 3.2 Server Actions

#### `src/lib/actions/admin/audit.ts` (novo arquivo)

##### `listAuditLogAction(filters: AuditFilters, cursor?: AuditCursor)` 

**Schema Zod (`audit.schemas.ts`):**

```typescript
export const AuditPeriodPresetSchema = z.enum(['24h','7d','30d','custom']);

export const AuditFiltersSchema = z.object({
  actions:        z.array(z.string().regex(/^[a-z_]+\.[a-z_]+$/)).max(20).optional(),
  actorProfileId: z.string().uuid().optional(),
  targetOrgId:    z.string().uuid().optional(),
  targetType:     z.string().regex(/^[a-z_]+$/).max(50).optional(),
  period: z.discriminatedUnion('preset', [
    z.object({ preset: z.literal('24h') }),
    z.object({ preset: z.literal('7d') }),
    z.object({ preset: z.literal('30d') }),
    z.object({
      preset: z.literal('custom'),
      from:   z.string().datetime(),
      to:     z.string().datetime(),
    }).refine(d => new Date(d.from) < new Date(d.to), 'from < to'),
  ]).optional(),
});

export const AuditCursorSchema = z.object({
  occurredAt: z.string().datetime(),
  id:         z.string().uuid(),
});

export type AuditFiltersInput = z.infer<typeof AuditFiltersSchema>;
export type AuditCursor       = z.infer<typeof AuditCursorSchema>;
```

**Output:**
```typescript
interface AuditLogRow {
  id:                   string;
  occurredAt:           string;
  actorProfileId:       string | null;
  actorEmailSnapshot:   string | null;
  action:               string;
  targetType:           string;
  targetId:             string | null;
  targetOrganizationId: string | null;
  diffBefore:           Record<string, unknown> | null;
  diffAfter:            Record<string, unknown> | null;
  ipAddress:            string | null;
  userAgent:            string | null;
  metadata:             Record<string, unknown> | null;
}

interface ListAuditResult {
  rows:       AuditLogRow[];
  nextCursor: AuditCursor | null;
}
```

**Business Logic:**

```typescript
'use server';
import 'server-only';
import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';
import { createClient } from '@/lib/supabase/server';

const PAGE_SIZE = 50;
const BILLING_REGEX = '^(plan|subscription|grant|org)\\.';

export async function listAuditLogAction(
  filters: AuditFiltersInput,
  cursor?: AuditCursor,
): Promise<ActionResponse<ListAuditResult>> {
  const parsed = AuditFiltersSchema.safeParse(filters);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Filtros inválidos.' };
  }
  const cursorParsed = cursor ? AuditCursorSchema.safeParse(cursor) : { success: true, data: undefined };
  if (!cursorParsed.success) {
    return { success: false, error: 'Cursor inválido.' };
  }

  try {
    const admin = await requirePlatformAdmin(); // notFound() se não-admin
    const supabase = await createClient();      // user JWT — RLS filtra também por defesa em profundidade

    let q = supabase
      .from('audit_log')
      .select('*')
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE + 1); // +1 para detectar se há próxima página

    // RBAC condicional para billing
    if (admin.role === 'billing') {
      q = q.filter('action', 'similar to', '(plan|subscription|grant|org)\\.%');
      // Postgres SIMILAR TO exige escape; alternativa: q.or() com 4 ilike. Spec valida — uso `.filter` com regex.
      // Implementação real: q = q.or('action.like.org.%,action.like.plan.%,action.like.subscription.%,action.like.grant.%');
    }

    if (parsed.data.actions?.length) q = q.in('action', parsed.data.actions);
    if (parsed.data.actorProfileId)  q = q.eq('actor_profile_id', parsed.data.actorProfileId);
    if (parsed.data.targetOrgId)     q = q.eq('target_organization_id', parsed.data.targetOrgId);
    if (parsed.data.targetType)      q = q.eq('target_type', parsed.data.targetType);

    if (parsed.data.period) {
      const { from, to } = resolvePeriod(parsed.data.period); // 24h/7d/30d → calcula intervalo
      q = q.gte('occurred_at', from).lte('occurred_at', to);
    }

    if (cursorParsed.data) {
      // Paginação keyset: (occurred_at, id) < cursor
      q = q.or(
        `occurred_at.lt.${cursorParsed.data.occurredAt},and(occurred_at.eq.${cursorParsed.data.occurredAt},id.lt.${cursorParsed.data.id})`,
      );
    }

    const { data, error } = await q;
    if (error) {
      console.error('[admin:audit:list]', error);
      return { success: false, error: 'Não foi possível carregar o audit.' };
    }

    const hasMore = (data ?? []).length > PAGE_SIZE;
    const rows = (data ?? []).slice(0, PAGE_SIZE).map(rowToCamelCase);
    const last = rows[rows.length - 1];
    const nextCursor = hasMore && last ? { occurredAt: last.occurredAt, id: last.id } : null;

    return { success: true, data: { rows, nextCursor } };
  } catch (err) {
    console.error('[admin:audit:list] unexpected', err);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}
```

**Sem `audit_write`** — leitura de audit não gera audit (evita feedback loop).

##### `getAuditLogEntryAction(id: string)`

Lookup por PK + RBAC. Para `billing`, `WHERE` adicional `action ~ '^(plan|subscription|grant|org)\\.'` — se row existe mas fora do escopo, retorna `'audit_entry_not_found'` (mensagem genérica que cobre tanto "não existe" quanto "fora do escopo billing"). Defesa por obscurity.

##### `searchAuditActorsAction(query: string)`

Autocomplete com `query.length >= 2`. Retorna até 10 admins distintos que aparecem em audit:

```sql
select distinct on (actor_profile_id)
       actor_profile_id, actor_email_snapshot
  from audit_log
 where actor_profile_id is not null
   and actor_email_snapshot ilike '%' || $1 || '%'
 order by actor_profile_id, occurred_at desc
 limit 10;
```

##### `getAuditActionRegistryAction()`

**NÃO consulta DB.** Retorna a lista estática de `src/lib/audit/actionRegistry.ts` (§3.5). Sem RBAC porque registry é metadata pública.

#### `src/lib/actions/admin/admin-auth.ts` (modificação — NOVA action)

##### `signInAdminAction(input: { email: string, password: string })`

> **Refactor obrigatório**: Sprint 04 entregou `AdminLoginForm.tsx` como Client Component chamando `supabase.auth.signInWithPassword` direto. Sprint 12 introduz Server Action wrapper para permitir rate limit + audit. Cliente passa a chamar `signInAdminAction` em vez do método Supabase direto.

**Schema Zod (`admin-auth.schemas.ts` — adicionar):**

```typescript
export const SignInAdminSchema = z.object({
  email:    z.string().email().max(320),
  password: z.string().min(1).max(128),
});
export type SignInAdminInput  = z.infer<typeof SignInAdminSchema>;

export interface SignInAdminResult {
  redirectTo: '/admin/mfa-challenge' | '/admin/mfa-enroll';
}
```

**Business Logic:**

```typescript
export async function signInAdminAction(
  input: SignInAdminInput,
): Promise<ActionResponse<SignInAdminResult>> {
  const parsed = SignInAdminSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: 'Credenciais inválidas.' };
  }

  const { ip, ua } = await getRequestMeta();
  const email = parsed.data.email.toLowerCase();

  if (!ip) {
    // Sem IP confiável (cabeçalhos ausentes em dev local): aceitar com IP placeholder.
    // Em prod atrás de Vercel, x-forwarded-for é confiável.
    console.warn('[admin:auth:signin] no IP available — accepting with placeholder');
  }

  // 1. Rate limit fail-closed (decisão (b))
  try {
    await assertAdminLoginRateLimit({ email, ip: ip ?? '0.0.0.0', userAgent: ua ?? null });
  } catch (err) {
    // Mensagem genérica não-revelatória (RNF-OBS-2)
    return { success: false, error: 'Muitas tentativas. Aguarde alguns minutos.' };
  }

  // 2. Sign-in real
  const supabase = await createClient();
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  // 3. Record attempt fail-open (decisão (b))
  await recordAdminLoginAttempt({
    email,
    ip: ip ?? '0.0.0.0',
    userAgent: ua ?? null,
    success: !signInErr,
  });

  if (signInErr) {
    if (
      signInErr.message.includes('Invalid login credentials') ||
      signInErr.message.includes('invalid_credentials')
    ) {
      return { success: false, error: 'E-mail ou senha incorretos.' };
    }
    if (signInErr.message.includes('Email not confirmed')) {
      return { success: false, error: 'Confirme seu e-mail antes de continuar.' };
    }
    console.error('[admin:auth:signin]', signInErr);
    return { success: false, error: 'Erro ao fazer login. Tente novamente.' };
  }

  // 4. Audit success
  const service = createServiceClient();
  await service.rpc('audit_login_admin_event', {
    p_email:      email,
    p_ip:         ip ?? '0.0.0.0',
    p_user_agent: ua,
    p_action:     'auth.login_admin_success',
    p_metadata:   {},
  });

  // 5. Determinar próximo passo (lógica idêntica ao AdminLoginForm Sprint 04)
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return {
    success: true,
    data: { redirectTo: aal?.nextLevel === 'aal2' ? '/admin/mfa-challenge' : '/admin/mfa-enroll' },
  };
}
```

### 3.3 Helpers

#### `src/lib/rateLimit/adminLogin.ts` (novo arquivo)

```typescript
import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';

const WINDOW_MINUTES = 10;
const MAX_PER_EMAIL  = 5;
const MAX_PER_IP     = 20;

export class RateLimitError extends Error {
  constructor(public readonly scope: 'email' | 'ip' | 'db_unavailable') {
    super(`rate_limit_${scope}`);
  }
}

interface RateLimitInput { email: string; ip: string; userAgent: string | null; }

export async function assertAdminLoginRateLimit(i: RateLimitInput): Promise<void> {
  const sb = createServiceClient();
  const { data, error } = await sb.rpc('count_admin_login_failures', {
    p_email:  i.email,
    p_ip:     i.ip,
    p_window: `${WINDOW_MINUTES} minutes`,
  });

  if (error) {
    console.error('[rate-limit] db error', error);
    throw new RateLimitError('db_unavailable'); // fail-closed (decisão (b))
  }

  const counts = (data ?? { by_email: 0, by_ip: 0 }) as { by_email: number; by_ip: number };

  if (counts.by_email >= MAX_PER_EMAIL) {
    await emitRateLimitAudit(sb, i, 'email', counts.by_email);
    throw new RateLimitError('email');
  }
  if (counts.by_ip >= MAX_PER_IP) {
    await emitRateLimitAudit(sb, i, 'ip', counts.by_ip);
    throw new RateLimitError('ip');
  }
}

export async function recordAdminLoginAttempt(
  i: RateLimitInput & { success: boolean },
): Promise<void> {
  try {
    const sb = createServiceClient();
    const { error } = await sb.rpc('record_admin_login_attempt', {
      p_email:      i.email,
      p_ip:         i.ip,
      p_user_agent: i.userAgent,
      p_success:    i.success,
    });
    if (error) console.error('[rate-limit] record error', error); // fail-open
  } catch (err) {
    console.error('[rate-limit] record unexpected', err); // fail-open
  }
}

async function emitRateLimitAudit(
  sb: ReturnType<typeof createServiceClient>,
  i: RateLimitInput,
  scope: 'email' | 'ip',
  attempts: number,
): Promise<void> {
  const { error } = await sb.rpc('audit_login_admin_event', {
    p_email:      i.email,
    p_ip:         i.ip,
    p_user_agent: i.userAgent,
    p_action:     'auth.login_rate_limited',
    p_metadata:   { scope, attempts, window_minutes: WINDOW_MINUTES },
  });
  if (error) console.error('[rate-limit] audit error', error); // fail-open mesmo aqui
}
```

#### `src/lib/audit/actionRegistry.ts` (novo arquivo)

```typescript
export const AUDIT_ACTION_REGISTRY = {
  'org.*':                    ['org.create', 'org.suspend', 'org.reactivate'],
  'subscription.*':           ['subscription.change_plan', 'subscription.extend_trial', 'subscription.cancel', 'subscription.reactivate', 'subscription.auto_expire'],
  'plan.*':                   ['plan.create', 'plan.update', 'plan.archive', 'plan.delete'],
  'grant.*':                  ['grant.create', 'grant.revoke'],
  'inspect.*':                ['inspect.read_leads', 'inspect.read_users', 'inspect.read_products', 'inspect.read_funnels', 'inspect.read_categories', 'inspect.read_tags', 'inspect.read_lead_origins', 'inspect.read_loss_reasons', 'inspect.read_whatsapp_groups'],
  'platform_admin.*':         ['platform_admin.invite_create', 'platform_admin.invite_revoke', 'platform_admin.invite_consume', 'platform_admin.role_change', 'platform_admin.deactivate', 'platform_admin.mfa_reset_request', 'platform_admin.mfa_reset_approve', 'platform_admin.mfa_reset_revoke', 'platform_admin.mfa_reset_consume'],
  'password_reset.*':         ['password_reset.complete_admin', 'password_reset.mfa_reenroll_complete'],
  'auth.*':                   ['auth.login_admin_success', 'auth.login_rate_limited'],
  'settings.*':               ['settings.update'],
  'feature_flag.*':           ['feature_flag.set'],
  'legal_policy.*':           ['legal_policy.create'],
  'integration_credential.*': ['integration_credential.create', 'integration_credential.rotate', 'integration_credential.revoke'],
  'email.*':                  ['email.offline_fallback'],
  'metrics.*':                ['metrics.refresh'],
  'break_glass.*':            ['break_glass.recover_owner'],
} as const;

export const AUDIT_BILLING_PREFIXES = ['org', 'plan', 'subscription', 'grant'] as const;

// Mapping de slug → cor de badge (token semântico)
export const AUDIT_ACTION_PALETTE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  // create → success (verde)
  'org.create': 'success', 'plan.create': 'success', 'grant.create': 'success', 'integration_credential.create': 'success', 'platform_admin.invite_create': 'success', 'legal_policy.create': 'success',
  // mutating updates → warning (amarelo)
  'subscription.change_plan': 'warning', 'subscription.extend_trial': 'warning', 'plan.update': 'warning', 'platform_admin.role_change': 'warning', 'settings.update': 'warning', 'feature_flag.set': 'warning', 'integration_credential.rotate': 'warning',
  // destructive → danger (vermelho)
  'org.suspend': 'danger', 'subscription.cancel': 'danger', 'plan.archive': 'danger', 'plan.delete': 'danger', 'grant.revoke': 'danger', 'platform_admin.deactivate': 'danger', 'platform_admin.invite_revoke': 'danger', 'integration_credential.revoke': 'danger', 'auth.login_rate_limited': 'danger', 'break_glass.recover_owner': 'danger',
  // reactivate → info (azul)
  'org.reactivate': 'info', 'subscription.reactivate': 'info',
  // login success / inspect / metrics / email fallback / mfa reenroll → neutral
  'auth.login_admin_success': 'neutral', 'metrics.refresh': 'neutral', 'email.offline_fallback': 'neutral', 'password_reset.complete_admin': 'neutral', 'password_reset.mfa_reenroll_complete': 'neutral', 'platform_admin.mfa_reset_request': 'neutral', 'platform_admin.mfa_reset_approve': 'neutral', 'platform_admin.mfa_reset_revoke': 'neutral', 'platform_admin.mfa_reset_consume': 'neutral', 'platform_admin.invite_consume': 'neutral', 'subscription.auto_expire': 'neutral',
  // inspect.* — todas neutral
  'inspect.read_leads': 'neutral', 'inspect.read_users': 'neutral', 'inspect.read_products': 'neutral', 'inspect.read_funnels': 'neutral', 'inspect.read_categories': 'neutral', 'inspect.read_tags': 'neutral', 'inspect.read_lead_origins': 'neutral', 'inspect.read_loss_reasons': 'neutral', 'inspect.read_whatsapp_groups': 'neutral',
};

export function paletteFor(action: string): 'success'|'warning'|'danger'|'info'|'neutral' {
  return AUDIT_ACTION_PALETTE[action] ?? 'neutral';
}
```

### 3.4 CLI — `scripts/break-glass.ts`

```typescript
#!/usr/bin/env tsx
import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { createClient } from '@supabase/supabase-js';

function exit(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main() {
  const url        = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret     = process.env.BREAK_GLASS_SECRET;
  const operator   = process.env.BREAK_GLASS_OPERATOR;

  if (!url)        exit('NEXT_PUBLIC_SUPABASE_URL missing');
  if (!serviceKey) exit('SUPABASE_SERVICE_ROLE_KEY missing');
  if (!secret)     exit('BREAK_GLASS_SECRET missing');
  if (!operator)   exit('BREAK_GLASS_OPERATOR missing (set to your name/email/handle)');

  const email = process.argv[2]?.toLowerCase().trim();
  if (!email || !email.match(/^[^@]+@[^@]+\.[^@]+$/)) {
    exit('Usage: tsx scripts/break-glass.ts <email>');
  }

  const sb = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Validar BREAK_GLASS_SECRET via hash (decisão (c))
  const { data: expected, error: hashErr } = await sb.rpc('get_break_glass_secret_hash');
  if (hashErr) exit(`Could not read secret hash: ${hashErr.message}`);
  if (!expected) exit('BREAK_GLASS_SECRET hash not configured — run setup SQL first (see runbook)');

  const computed = createHash('sha256').update(secret).digest('hex');
  if (computed !== expected) exit('BREAK_GLASS_SECRET invalid');

  // 2. Confirmação digitada (RNF-UX-2)
  console.log(`\n⚠ BREAK-GLASS: vai restaurar OWNER + invalidar MFA do profile com email '${email}'.`);
  console.log(`Operator: ${operator}\n`);
  const rl = createInterface({ input: stdin, output: stdout });
  const typed = await rl.question(`Digite o email '${email}' para confirmar: `);
  rl.close();
  if (typed.toLowerCase().trim() !== email) exit('Email confirmation mismatch — abort.');

  // 3. RPC (decisão (d) — etapa 1)
  const originHost = process.env.HOSTNAME ?? hostname();
  const { data, error } = await sb.rpc('break_glass_recover_owner', {
    p_email: email,
    p_operator: operator,
    p_origin_host: originHost,
  });
  if (error) exit(`RPC error: ${error.message}`);

  const result = data as {
    profile_id: string;
    platform_admin_id: string;
    audit_log_id: string;
    was_active: boolean | null;
    old_role: string | null;
  };

  // 4. Auth Admin API — invalidar TOTP factors (decisão (d) — etapa 2)
  const { data: usersData, error: listErr } = await sb.auth.admin.listUsers();
  if (listErr) exit(`auth.admin.listUsers failed (RPC sucedeu — rerun é seguro): ${listErr.message}`);

  const target = usersData.users.find((u) => u.email?.toLowerCase() === email);
  if (!target) {
    console.warn(`⚠ Auth user not found for ${email} (RPC sucedeu — out-of-sync state).`);
    console.warn('  RPC restored platform_admins row, but auth.users entry missing.');
    console.warn('  Continue manually via Supabase dashboard or rerun after fixing.');
  } else {
    const { data: factorsResp, error: factErr } = await sb.auth.admin.mfa.listFactors({
      userId: target.id,
    });
    if (factErr) {
      console.warn(`⚠ listFactors failed: ${factErr.message} (rerun é seguro)`);
    } else {
      const totps = factorsResp.factors.filter((f) => f.factor_type === 'totp');
      let deleted = 0;
      for (const f of totps) {
        const { error: delErr } = await sb.auth.admin.mfa.deleteFactor({
          userId: target.id,
          id: f.id,
        });
        if (delErr) {
          console.warn(`⚠ deleteFactor ${f.id} failed: ${delErr.message} (rerun é seguro)`);
        } else {
          deleted++;
        }
      }
      console.log(`✓ MFA factors invalidated: ${deleted}/${totps.length}`);
    }
  }

  console.log(`\n✓ Owner restored. profile_id=${result.profile_id}`);
  console.log(`✓ platform_admin_id=${result.platform_admin_id}`);
  console.log(`✓ audit_log_id=${result.audit_log_id}`);
  if (result.was_active !== null) {
    console.log(`  Previous state: was_active=${result.was_active}, old_role=${result.old_role}`);
  } else {
    console.log('  Previous state: no platform_admins entry — created new');
  }
  console.log(`\nTarget must complete MFA re-enroll on next /admin/login (Sprint 11 mfa_reset_required flag).`);
}

main().catch((err) => exit(err?.message ?? String(err)));
```

**Características:**
- **Sem `import 'server-only'`** — script roda em CLI Node.
- **Sem imports de `next/*` ou `src/app/*`** — verificado por Guardian via grep.
- Imports limitados a `@supabase/supabase-js` (já dep do projeto) + Node built-ins (`crypto`, `readline`, `os`).
- `tsx` é dep nova (devDependency) — `npm install -D tsx` no Phase 2.
- Adicionar script em `package.json`: `"break-glass": "tsx scripts/break-glass.ts"`.

---

## 4. External API Integration

### Supabase Auth Admin API (primeira utilização no projeto)

**Endpoints usados (via `@supabase/supabase-js` JS client com service role):**

- `auth.admin.listUsers()` — lookup do `auth.user.id` pelo email (não há RPC equivalente em SQL — `auth.users.email` não é exposto via PostgREST).
- `auth.admin.mfa.listFactors({ userId })` — lista factors TOTP (verified+unverified).
- `auth.admin.mfa.deleteFactor({ userId, id })` — invalidação atômica de cada factor.

**Autenticação:** `SUPABASE_SERVICE_ROLE_KEY` no env do CLI. **Nunca** embarcar em cliente.

**Localização da utilização:** APENAS `scripts/break-glass.ts`. **Não** importar `auth.admin.*` em código de `src/`.

**Variáveis de ambiente necessárias:**
```
NEXT_PUBLIC_SUPABASE_URL=         # já em .env.local
SUPABASE_SERVICE_ROLE_KEY=        # já em .env.local
BREAK_GLASS_SECRET=               # NOVO — cofre separado da service role
BREAK_GLASS_OPERATOR=             # NOVO — identidade humana do operador (nome/email/handle)
```

**Atualização de `.env.example`:** adicionar `BREAK_GLASS_SECRET=` e `BREAK_GLASS_OPERATOR=` com comentário "set only on machines with break-glass authority".

---

## 5. Componentes de UI

Todos seguem o contrato em `design_system/components/CONTRACT.md` — wrappers finos sobre Radix Primitives, tokens semânticos, variantes via `cva`. Lista de componentes do design system reutilizados:

### Component Tree

```
Page: /admin/audit
├── AuditPage (page.tsx, server component)
│   ├── AuditFilters (client) — Combobox, MultiSelect, DateRangePicker
│   └── AuditTable (client) — table, badge, skeleton
│       ├── AuditActionBadge
│       └── AuditTableRow → click → router.push(/admin/audit/[id])

Page: /admin/audit/[id]
├── AuditDetailPage (page.tsx, server component) — loadEntry via getAuditLogEntryAction
│   ├── AuditDetailHeader — badge, timestamp, actor, target link
│   ├── DiffTable                  (when diff_before AND diff_after)
│   ├── JsonView (after only)      (when only diff_after)
│   ├── EmptyDiffNotice             (when neither)
│   ├── JsonView (metadata)
│   └── NetworkContext — IP + UA
```

### `AuditFilters` (`src/components/admin/audit/AuditFilters.tsx`)

**Props:**
```typescript
interface Props {
  initialFilters: AuditFiltersInput;
  registry: typeof AUDIT_ACTION_REGISTRY;
  onChange: (filters: AuditFiltersInput) => void;
}
```

**Design system components used:**
- `Input`/`Combobox` (Combobox composto a partir de `Popover`+`Command` shadcn) para autocomplete de admin/org.
- `Select` para `targetType`.
- Custom `MultiSelect` agrupado (ou checkbox list dentro de Popover) para `actions` — agrupado por prefixo do registry.
- Custom `DateRangePicker` (composto de 2 `Calendar` + `Popover`) para período custom.
- `Button` variant `secondary` para "Limpar filtros".
- `Button` variant `ghost` para toggle collapse mobile.

**Semantic tokens used:**
- Background: `bg-surface-raised` (card surface).
- Text: `text-text-primary`, `text-text-secondary`.
- Border: `border-border`, `border-border-subtle` (APRENDIZADO 2026-04-16 — escrever `border-border-*`).
- Action: `bg-action-primary`/`text-action-primary-fg` (botão Apply implícito — auto-apply on change).

**State (URL-synced via Next.js `searchParams`):**
- `actions` (CSV no URL: `?action=org.suspend,org.reactivate`).
- `actor` (UUID: `?actor=...`).
- `targetOrg` (UUID: `?org=...`).
- `targetType` (string: `?type=organization`).
- `period` (preset string ou `from`/`to` ISO).

### `AuditTable` (`src/components/admin/audit/AuditTable.tsx`)

**Design system components used:**
- `Table` + `TableHeader`/`TableBody`/`TableRow`/`TableCell` (shadcn).
- `Badge` via `AuditActionBadge` (custom wrapper).
- `Skeleton` para loading inicial (6 linhas placeholder).
- `Button` variant `ghost` para "Carregar mais" no fim.
- `Tooltip` para timestamp absoluto (decisão (i)).

**Semantic tokens used:**
- `bg-surface-base` (linhas pares), `bg-surface-raised` (linhas ímpares opcional).
- `text-text-primary` / `text-text-secondary`.
- `border-border-subtle` para divisores.

### `AuditDetailPage` + `DiffTable` + `JsonView`

**`DiffTable` props:**
```typescript
interface Props { before: Record<string, unknown> | null; after: Record<string, unknown> | null; }
```

**Implementação (decisão (g)):** ~80 linhas TSX. Layout 3 colunas, ênfase via `border-feedback-warning-border` em linhas onde `before[k] !== after[k]`. Valores formatados via `JSON.stringify(v, null, 2)` em `<pre>`. Sem lib externa.

**`JsonView` props:**
```typescript
interface Props { value: unknown; indent?: number; }
```

**Implementação:** recursive render com `<pre>` + token `text-text-primary` (chaves em `font-medium`) + `text-text-secondary` (valores).

### `AuditActionBadge` (`src/components/admin/audit/AuditActionBadge.tsx`)

**Props:** `{ action: string }`. Lookup em `AUDIT_ACTION_PALETTE` (§3.5). Renderiza `<Badge>` com variant resolvida (`success`/`warning`/`danger`/`info`/`neutral`). Slugs não-mapeados → `neutral` + `<Tooltip>` "Slug não registrado em actionRegistry.ts".

### `AdminLoginForm` (modificação leve — `src/components/admin/AdminLoginForm.tsx`)

**Refactor:** substituir `await supabase.auth.signInWithPassword(...)` direto por `await signInAdminAction({ email, password })`. Tratar erro retornado:
- `error === 'Muitas tentativas. Aguarde alguns minutos.'` → exibir literal (não personalizar).
- Outros erros → mensagens existentes.

Após `success: true`: `router.push(data.redirectTo)` (mesmo comportamento de Sprint 04).

### `AdminSidebar` (modificação leve — `src/components/admin/AdminSidebar.tsx`)

Adicionar item "Audit log" → `href="/admin/audit"`, ícone `History` (Lucide), em seção "Administração" (junto com "Administradores" do Sprint 11). Visível para todos os papéis (RBAC server-side filtra na Server Action).

---

## 6. Edge Cases

### Audit UI

- [ ] **Lista vazia (filtros restritivos)** → empty state ilustrado + CTA "Limpar filtros".
- [ ] **`actor_profile_id=NULL`** (login falhou ou ação anônima) → coluna "Quem" mostra `actor_email_snapshot` ou "—".
- [ ] **`target_id=NULL`** (slugs `metrics.refresh`, `settings.update`, etc.) → coluna "Alvo" mostra `target_type` + `metadata.key` quando aplicável.
- [ ] **`diff_before=null AND diff_after=null`** (eventos como `auth.login_admin_success`, `inspect.*`) → drawer mostra "Sem diff registrado".
- [ ] **`metadata` >50KB** → truncar visualmente com "Ver completo" + copy-button JSON.
- [ ] **0 linhas + cursor null** → empty state correto, sem loading infinito.
- [ ] **Fim do dataset** → botão "Carregar mais" desabilita.
- [ ] **billing força `?action=platform_admin.invite_create` na URL** → query SQL aplica filtro requested AND regex billing → empty (intersecção ∅).
- [ ] **`getAuditLogEntryAction(id)` por billing para slug fora-do-escopo** → retorna `'audit_entry_not_found'` (mensagem genérica).

### Rate Limit

- [ ] **4 falhas + 1 sucesso → contador zera?** **Não** — contador é apenas falhas (`success=false` no FILTER). Atacante alterna emails para evadir o reset, mas escopo IP captura ataque distribuído.
- [ ] **Clock skew app↔DB** → janela usa `now()` do banco (`p_window` é interval relativo a `now()` server-side).
- [ ] **Usuário legítimo com 5 falhas seguidas** (esqueceu senha) → vê mensagem genérica; recurso é `/admin/forgot-password` (Sprint 11) — flow de password reset NÃO está atrás do rate limit.
- [ ] **NAT corporativo (vários admins, mesmo IP)** → 20/IP/10min suficiente para equipe Axon (<10 admins, A-2). Documentado no fora-de-escopo.
- [ ] **`x-forwarded-for` ausente em dev local** → fallback para `'0.0.0.0'` placeholder (warn em log). Em prod atrás de Vercel, sempre presente.
- [ ] **DB indisponível durante `assertAdminLoginRateLimit`** → throw `RateLimitError('db_unavailable')` → retorna erro genérico → login bloqueado (decisão (b) fail-closed).
- [ ] **DB indisponível durante `recordAdminLoginAttempt`** → log warn → login flui (decisão (b) fail-open).
- [ ] **Casing variado de email** (`FOO@axon.io` vs `foo@axon.io`) → `lower()` em RPC + Server Action normaliza; tratado como mesmo email.

### Break-glass

- [ ] **Email correto digitado em casing diferente** no prompt → `toLowerCase().trim()` em ambos lados; spec valida.
- [ ] **Profile com factors TOTP `unverified`** (enroll incompleto) → CLI deleta TODOS os TOTP factors (verified + unverified) para garantir re-enroll limpo.
- [ ] **Break-glass duas vezes consecutivas (idempotência)** → 2ª execução é no-op em `platform_admins` + no-op em `mfa_factors` + grava 2ª linha de audit (event log).
- [ ] **`BREAK_GLASS_SECRET` correto mas hash não setado em settings (boot inicial)** → CLI falha com `'BREAK_GLASS_SECRET hash not configured — run setup SQL first'`.
- [ ] **Admin alvo já logado em outra sessão** → sessão antiga continua até expirar (8h TTL) MAS `mfa_reset_required=true` força redirect no próximo refresh do middleware (max 1h gap).
- [ ] **Auth user não existe** (`auth.admin.listUsers` não encontra email) → CLI completa RPC + warn "out-of-sync state" + sai com código 0 (RPC sucedeu); operador investiga manualmente.
- [ ] **`auth.admin.deleteFactor` falha em factor específico** → CLI continua com próximos + warn "rerun é seguro" + sai com código 0.
- [ ] **Profile NÃO existe para o email passado** → RPC raise `'profile_not_found'`; CLI sai com mensagem clara (sem write parcial — RPC é transacional).

---

## 7. Acceptance Criteria

### Database
- [ ] Migration roda sem erros em dry-run (GATE 1).
- [ ] Migration idempotente (`IF NOT EXISTS`, `OR REPLACE`).
- [ ] `login_attempts_admin` com FORCE RLS ON validado via `SELECT relforcerowsecurity FROM pg_class WHERE relname='login_attempts_admin' = t`.
- [ ] `audit_log.retention_expires_at` existe + nullable + default NULL.
- [ ] 4 RPCs novas com `prosecdef=true` + `proconfig` contendo `search_path=public`.
- [ ] `has_function_privilege('anon', '...', 'execute') = false` para todas as 4 RPCs.
- [ ] `has_function_privilege('authenticated', '...', 'execute') = false` para `break_glass_recover_owner` (defesa em profundidade).
- [ ] `has_function_privilege('service_role', '...', 'execute') = true` para todas.
- [ ] Índices `laa_email_occurred_idx`, `laa_ip_occurred_idx`, `laa_occurred_idx` criados.
- [ ] Triggers `audit_log_deny_update_delete` e `audit_log_deny_truncate` ainda ativos (não regredidos por Sprint 12).
- [ ] **PROJECT_CONTEXT.md §2** atualizado com `login_attempts_admin` (catálogo de auth events da plataforma; sem `organization_id` por ser evento pré-autenticação).

### Backend
- [ ] Todas as Server Actions validam input com Zod antes de chamar Supabase.
- [ ] Todas retornam `ActionResponse<T>` (nunca lançam exceção).
- [ ] Erros logados em servidor (`console.error`) com prefix do módulo (`[admin:audit:...]`, `[rate-limit]`).
- [ ] `signInAdminAction` chama `assertAdminLoginRateLimit` ANTES de `signInWithPassword`.
- [ ] `signInAdminAction` chama `recordAdminLoginAttempt` em ambos sucesso e falha.
- [ ] `signInAdminAction` chama `audit_login_admin_event(p_action='auth.login_admin_success')` apenas em sucesso.
- [ ] `assertAdminLoginRateLimit` falha-closed em DB error (decisão (b)).
- [ ] `recordAdminLoginAttempt` falha-open em DB error (decisão (b)).
- [ ] `listAuditLogAction` aplica regex `^(plan|subscription|grant|org)\.` quando `requirePlatformAdmin().role === 'billing'` (decisão (f)).
- [ ] Mensagem de rate limit no frontend é literal "Muitas tentativas. Aguarde alguns minutos." (sem variação que vaze info).
- [ ] CLI `scripts/break-glass.ts` valida env vars + hash + confirmação digitada ANTES de chamar RPC.
- [ ] CLI nunca imprime `BREAK_GLASS_SECRET` em `console.log/error/warn` (Guardian valida via grep).
- [ ] CLI sem imports de `next/*`, `src/app/*`, `src/middleware*` (Guardian valida via grep).

### Frontend (design system compliance)
- [ ] O código passa em todas as checagens do `agents/quality/guardian.md` § 1a + § 1b. Guardian aprova GATE 4.
- [ ] Componentes verificados com `data-theme="dark"` togglado.
- [ ] `verify-design.mjs --changed` retorna 0 violações (GATE 5 estático).
- [ ] Filtros se mantêm em URL searchParams (recarregar preserva).
- [ ] Drawer/detail renderiza nos 3 estados (with diff, creation event sem before, sem diff algum).

### Testing (GATE 4.5)
- [ ] `tests/integration/admin-audit.test.ts` ~25 testes — listagem com filtros, RBAC owner/support/billing, paginação keyset, validação Zod.
- [ ] `tests/integration/admin-rate-limit.test.ts` ~12 testes — 5/email + 20/IP, fail-closed/fail-open, casing, audit emit em rate limit.
- [ ] `tests/integration/break-glass-rpc.test.ts` ~12 testes — happy path RPC, idempotência, profile inexistente, REVOKE de anon/authenticated, audit metadata.
- [ ] Total ~49 testes, 0 falhas, 0 skips.
- [ ] Performance: integration test seeda 100k linhas + assert `EXPLAIN ANALYZE` p95 `<500ms`.

---

## 8. Implementation Plan

### Phase 1: Database (`@db-admin`) — ~25min

1. Migration `supabase/migrations/<timestamp>_admin_12_audit_ui_rate_limit_break_glass.sql`:
   - `CREATE EXTENSION IF NOT EXISTS pgcrypto;` (idempotente — já v1.3).
   - `CREATE TABLE login_attempts_admin` + 3 índices + FORCE RLS + 1 policy SELECT.
   - `ALTER TABLE audit_log ADD COLUMN retention_expires_at`.
   - 5 RPCs (`record_admin_login_attempt`, `count_admin_login_failures`, `audit_login_admin_event`, `get_break_glass_secret_hash`, `break_glass_recover_owner`) + REVOKE + GRANT.
2. Validação pós-migration: 9 SELECTs (FORCE RLS, prosecdef, has_function_privilege, índices presentes, triggers ainda ativos, coluna retention_expires_at presente).
3. Atualizar `docs/PROJECT_CONTEXT.md` §2 (login_attempts_admin) + §3 (D-7 fixado) + §5 ganha bloco §5f.

**GATE 1** (dry-run + RLS coverage check) executado pelo Tech Lead.

### Phase 2: Backend (`@backend`) — ~60min

1. `src/lib/audit/actionRegistry.ts` (registry estático).
2. `src/lib/rateLimit/adminLogin.ts` (helper).
3. `src/lib/actions/admin/audit.ts` + `audit.schemas.ts`.
4. Modificar `src/lib/actions/admin/admin-auth.ts` + `admin-auth.schemas.ts` — adicionar `signInAdminAction` + `SignInAdminSchema`.
5. `scripts/break-glass.ts` + adicionar entry no `package.json` (`"break-glass": "tsx scripts/break-glass.ts"`).
6. `npm install -D tsx` (se ainda não está nas devDeps).
7. Atualizar `.env.example` com `BREAK_GLASS_SECRET=` e `BREAK_GLASS_OPERATOR=`.
8. Setup runbook `docs/admin_area/runbook_break_glass.md` — pré-requisitos, seed do hash via `admin_set_setting`, passos de execução, rotação, recuperação de erro parcial.

**GATE 2** (build + lint) executado pelo Tech Lead.

### Phase 3: Integration Tests (`@qa-integration`) — ~45min

1. `tests/integration/admin-audit.test.ts` — todos os caminhos da Server Action listAudit + getEntry + searchActors + RBAC.
2. `tests/integration/admin-rate-limit.test.ts` — 5/email + 20/IP + fail modes + audit emit.
3. `tests/integration/break-glass-rpc.test.ts` — RPC apenas (CLI propriamente é teste manual no runbook).
4. Validação pós: `npm test -- --run tests/integration/` retorna 0 falhas, 0 skips.

**GATE 4.5** executado pelo Tech Lead após Guardian aprovar.

### Phase 4: Frontend (`@frontend+`) — ~80min

1. `src/app/admin/audit/page.tsx` (server component) + `loading.tsx` + `error.tsx`.
2. `src/app/admin/audit/[id]/page.tsx`.
3. `src/components/admin/audit/AuditFilters.tsx`.
4. `src/components/admin/audit/AuditTable.tsx`.
5. `src/components/admin/audit/AuditActionBadge.tsx`.
6. `src/components/admin/audit/JsonView.tsx`.
7. `src/components/admin/audit/DiffTable.tsx`.
8. Modificar `src/components/admin/AdminLoginForm.tsx` (Server Action wrapper).
9. Modificar `src/components/admin/AdminSidebar.tsx` (novo item).

**GATE 2** (build + lint).

### Phase 5: Guardian (`@guardian`) — ~10min

GATE 4: revisar conformidade design system, isolamento admin↔customer, sem hex literais, sem `any`, sem botões inline (APRENDIZADOS 2026-04-21+2026-04-20), CLI sem imports proibidos, mensagem rate limit literal sem variação informativa.

### Phase 6: Gates finais

1. GATE 4.5 (re-rodar integration tests após code review).
2. GATE 5 estático (`verify-design.mjs --changed`).
3. GATE 5 manual (responsividade 375/1440 da `/admin/audit` + drawer).

**Total estimado:** ~3h30 + buffer de 1h para retries.

---

## 9. Risks & Mitigations

### Risk 1: Bypass de rate limit via Supabase Auth direto
**Impact:** Médio (vetor de brute force se atacante chama `signInWithPassword` direto pelo Supabase Auth API sem passar pelo nosso wrapper).
**Probability:** Baixa (atacante precisaria conhecer o domínio admin + URL da API + project ref).
**Mitigation:** Defesa em camadas — (1) Supabase Auth tem rate limit próprio configurável no projeto; (2) `RNF-OBS-2` exige observabilidade de tentativas falhadas via `login_attempts_admin` (mas só captura tentativas que passaram pelo nosso wrapper); (3) Sprint 13 entrega origin isolation (subdomínio `admin.*`) que reduz atratividade do alvo. Documentar limitação em runbook.

### Risk 2: Hash de `BREAK_GLASS_SECRET` exposto em logs
**Impact:** Alto (atacante com hash + service role compromete owner).
**Probability:** Baixa (RPC retorna o hash apenas para service role; CLI compara em memória).
**Mitigation:** (1) RPC `get_break_glass_secret_hash()` REVOKE de `public/anon/authenticated`; (2) CLI nunca loga `secret` ou `expected` (Guardian grep); (3) hash em `platform_settings.value_text` lido apenas via RPC (não SELECT direto); (4) runbook documenta cofre separado.

### Risk 3: Integração com Auth Admin API frágil
**Impact:** Médio (mudança de assinatura em upgrade do Supabase).
**Probability:** Média (Supabase em rolling release).
**Mitigation:** (1) Idempotência do CLI permite rerun se chamada falhar; (2) erros de Auth API só warn, não falham — RPC já restaurou estado; (3) integration test foca na RPC SQL (estável), não no CLI.

### Risk 4: Performance da listagem audit em escala maior
**Impact:** Médio (>1M linhas em audit_log dentro de 1 ano).
**Probability:** Baixa no MVP (poucos clientes ainda).
**Mitigation:** (1) Índices existentes cobrem os filtros principais; (2) D-7 retenção em fase 2 reduz volume; (3) paginação keyset escala linearmente. Revisar se p95 cair fora de 500ms em prod.

### Risk 5: Confusão entre `actor_profile_id=null` legítimo vs bug
**Impact:** Baixo (UI mostra "—" mas auditor pode achar que é dado faltando).
**Probability:** Média (login_rate_limited e alguns inspect.* terão null).
**Mitigation:** UI mostra `actor_email_snapshot` quando `actor_profile_id=null`, ou "—" se ambos null. Runbook documenta os casos esperados.

---

## 10. Dependencies

### Internal
- [x] Sprint 03 ✅ — `audit_log` + `audit_write` + triggers de deny + helper `writeAudit`.
- [x] Sprint 04 ✅ — `/admin/login` + middleware `requireAdminSession` + AAL2 enforcement.
- [x] Sprint 02 ✅ — `platform_admins` + `requirePlatformAdmin*` + RBAC matrix.
- [x] Sprint 09 ✅ — `platform_settings` + `admin_set_setting` (usado para seed do hash).
- [x] Sprint 11 ✅ — `profiles.mfa_reset_required` + middleware lê em cada request.

### External
- [x] Supabase Auth Admin API (já disponível com service role key existente).
- [ ] **Operacional**: definir cofre separado para `BREAK_GLASS_SECRET` (1Password vault distinto, AWS Secrets Manager rotação trimestral, ou equivalente). Cobrança de produto (não bloqueia técnico).

### Devs
- [ ] `tsx` como devDependency (`npm install -D tsx`).

---

## 11. Rollback Plan

### Cenário 1: Migration falhou (GATE 1)
1. `@db-admin` analisa erro do `supabase db push --dry-run`.
2. Tech Lead executa `git restore supabase/migrations/<timestamp>_admin_12_*.sql` (arquivo nunca foi aplicado).
3. Re-delegar com contexto.

### Cenário 2: Migration aplicada + Backend falhou
1. Tech Lead `git revert <hash>` dos commits de backend.
2. `@db-admin` cria migration de rollback:
   ```sql
   drop function if exists public.break_glass_recover_owner(text, text, text);
   drop function if exists public.get_break_glass_secret_hash();
   drop function if exists public.audit_login_admin_event(text, inet, text, text, jsonb);
   drop function if exists public.count_admin_login_failures(text, inet, interval);
   drop function if exists public.record_admin_login_attempt(text, inet, text, boolean);
   drop table if exists public.login_attempts_admin;
   alter table public.audit_log drop column if exists retention_expires_at;
   ```
3. Aplicar via Supabase CLI.

### Cenário 3: Frontend quebrou produção (pós-deploy)
1. Vercel rollback para deploy anterior (UI imediato).
2. Backend Server Actions são compatíveis backwards (não removem nada existente — apenas adicionam `signInAdminAction`).
3. AdminLoginForm rollback restaura o flow Client direto.

### Cenário 4: Break-glass CLI compromete estado
1. **Não há rollback automático** — execução de break-glass por design altera estado de auth/admin.
2. Audit log preserva evidência completa (`metadata.operator`, `metadata.origin_host`, `metadata.platform_admin_id`).
3. Investigação pós-incidente via `SELECT * FROM audit_log WHERE action='break_glass.recover_owner' ORDER BY occurred_at DESC` + cruzamento com `platform_admins` history.
4. Reverter manualmente via UI Sprint 11 (desativar admin recém-criado, etc.).

---

## Approval

**Created by:** @spec-writer (cold review pelo `@sanity-checker` em seguida)
**Sprint:** admin_12
**Date:** 2026-04-28
**Status:** Draft — aguardando S0–S6 approval pelo `@sanity-checker`
