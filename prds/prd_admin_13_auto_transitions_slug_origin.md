# PRD: Transições automáticas de subscription + slug imutável pós-login + origin isolation

**Template:** PRD_COMPLETE
**Complexity Score:** 15 points
**Sprint:** sprint_admin_13_auto_transitions_slug_immutable_origin_isolation
**Created:** 2026-04-29
**Status:** Draft

---

## 1. Overview

### Business Goal

Fechar três obrigações ainda em aberto do PRD da admin area que viram visíveis simultaneamente no Sprint 13:

1. **Transições automáticas de subscription (RF-SUB-6, RF-SUB-7, G-23, D-9)** — hoje a única forma de `trial → trial_expired`, `past_due (excedido grace) → suspensa`, `cancelada (período pago vencido) → suspensa` é o lazy-check do middleware admin (Sprint 06). Se nenhum admin abrir aquela rota tocando aquela subscription, ela fica em status divergente do real, e o customer continua acessando além do permitido. SLA-alvo: ≤15min entre vencimento e flip.
2. **Slug imutável desde a criação (RF-ORG-9, INV-9, G-20)** — proteger URLs em uso, links de convite emitidos e integrações que cachearam o slug. **Decisão simplificada (2026-04-29):** slug é imutável desde a criação (não há janela editável pré-login). Mudança operacional fica como runbook fora da UI. RF-ORG-9 do PRD original previa janela editável pré-login; este sprint adota a versão mais estrita.
3. **Origin isolation de deploy (RNF-SEC-1, RNF-SEC-2, T-01)** — PRD exige que customer host **nunca** sirva rotas `(admin)`. Hoje o route group existe (Sprint 04), mas o mesmo hostname serve as duas árvores — basta digitar `/admin/login` no host customer. Subdomínio dedicado `admin.<host>` resolve.

### User Story

- Como **platform admin owner**, eu quero que assinaturas vencidas/em atraso sejam bloqueadas automaticamente, para que receita fantasma e acesso indevido sejam contidos sem ação manual.
- Como **operador da Axon**, eu quero que o slug de uma org permaneça estável depois que o cliente começa a usar, para que URLs e links de convite não quebrem.
- Como **engenheiro de segurança**, eu quero que `/admin/*` não exista no host customer, para que comprometer o customer app não exponha a tela de login admin (T-01).
- Como **customer user de uma org com trial vencido**, eu quero ver uma tela explicativa ("seu trial terminou, contate o suporte") em vez de 401/403, para entender o estado da minha conta.

### Success Metrics

- **Latência de transição automática:** trial com `period_end < now()` → `trial_expired` em ≤15min, sem intervenção manual.
- **Slug imutável:** 0 mudanças bem-sucedidas de slug em qualquer org via UI/RPC/SQL aplicacional.
- **Origin isolation:** request a `<customer-host>/admin/*` retorna 404 (não 401/redirect que confirmariam a existência da rota).
- **Idempotência cron:** rerun consecutivo no mesmo minuto altera 0 linhas e gera 0 audit rows duplicados.

---

## 2. Database Requirements

### Modified Tables

#### Table: `public.audit_log`

Sem alterações de schema. Será **escrito por cron** com `actor_profile_id = NULL` e `metadata->>'source' = 'cron'`. Confirmação de que `audit_write` (Sprint 03) aceita NULL: §5c do PROJECT_CONTEXT já documenta para `setting.update`.

> Se a função `audit_write` ainda exigir `actor NOT NULL`, este PRD pede ajuste mínimo na função (NULL permitido apenas com `metadata.source` em whitelist `('cron', 'system')`). `@db-admin` valida no preflight.

### New Database Objects (functions/triggers/extensions)

#### 1. Trigger `prevent_slug_change` (BEFORE UPDATE OF slug ON public.organizations)

Versão simplificada: slug é imutável desde a criação. UPDATE no-op (mesmo slug) é permitido para idempotência.

```sql
CREATE OR REPLACE FUNCTION public._prevent_slug_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'org_slug_immutable'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'organization_id', OLD.id,
              'current_slug', OLD.slug,
              'attempted_slug', NEW.slug
            )::text;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER prevent_slug_change
BEFORE UPDATE OF slug ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public._prevent_slug_change();
```

> **Decisão de produto (2026-04-29):** simplificação da regra original. Não há janela editável pré-login. Mudança operacional fica como runbook fora da UI.

#### 2. Função privada `_apply_subscription_transitions(p_org_id uuid DEFAULT NULL) returns jsonb`

Coração da transição. Usada tanto pelo cron (NULL = todas as orgs) quanto pelo lazy-check do middleware (org específica).

```sql
CREATE OR REPLACE FUNCTION public._apply_subscription_transitions(
  p_org_id uuid DEFAULT NULL,
  p_source text DEFAULT 'cron'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grace_days int;
  v_total int := 0;
  v_trial_expired int := 0;
  v_past_due_blocked int := 0;
  v_cancelada_blocked int := 0;
  r record;
BEGIN
  -- past_due_grace_days é setting global (Sprint 09)
  SELECT value_int INTO v_grace_days
  FROM platform_settings
  WHERE key = 'past_due_grace_days';
  v_grace_days := COALESCE(v_grace_days, 7);

  -- 1) trial → trial_expired
  FOR r IN
    SELECT id, organization_id, status, period_end
    FROM subscriptions
    WHERE status = 'trial'
      AND period_end IS NOT NULL
      AND period_end < now()
      AND (p_org_id IS NULL OR organization_id = p_org_id)
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE subscriptions SET status = 'trial_expired', updated_at = now() WHERE id = r.id;
    PERFORM audit_write(
      'subscription.auto_expire'::text,
      'subscription'::text,
      r.id,
      r.organization_id,
      jsonb_build_object('status', 'trial'),
      jsonb_build_object('status', 'trial_expired'),
      jsonb_build_object('source', p_source, 'period_end', r.period_end)
    );
    v_trial_expired := v_trial_expired + 1;
  END LOOP;

  -- 2) past_due (excedido grace) → suspensa
  FOR r IN
    SELECT id, organization_id, status, period_end
    FROM subscriptions
    WHERE status = 'past_due'
      AND period_end IS NOT NULL
      AND period_end + (v_grace_days || ' days')::interval < now()
      AND (p_org_id IS NULL OR organization_id = p_org_id)
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE subscriptions SET status = 'suspensa', updated_at = now() WHERE id = r.id;
    PERFORM audit_write(
      'subscription.auto_block_past_due'::text,
      'subscription'::text,
      r.id,
      r.organization_id,
      jsonb_build_object('status', 'past_due'),
      jsonb_build_object('status', 'suspensa'),
      jsonb_build_object('source', p_source, 'period_end', r.period_end, 'grace_days', v_grace_days)
    );
    v_past_due_blocked := v_past_due_blocked + 1;
  END LOOP;

  -- 3) cancelada (período pago vencido) → suspensa
  FOR r IN
    SELECT id, organization_id, status, period_end
    FROM subscriptions
    WHERE status = 'cancelada'
      AND period_end IS NOT NULL
      AND period_end < now()
      AND (p_org_id IS NULL OR organization_id = p_org_id)
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE subscriptions SET status = 'suspensa', updated_at = now() WHERE id = r.id;
    PERFORM audit_write(
      'subscription.auto_block_cancelled'::text,
      'subscription'::text,
      r.id,
      r.organization_id,
      jsonb_build_object('status', 'cancelada'),
      jsonb_build_object('status', 'suspensa'),
      jsonb_build_object('source', p_source, 'period_end', r.period_end)
    );
    v_cancelada_blocked := v_cancelada_blocked + 1;
  END LOOP;

  v_total := v_trial_expired + v_past_due_blocked + v_cancelada_blocked;
  RETURN jsonb_build_object(
    'transitioned', v_total,
    'trial_expired', v_trial_expired,
    'past_due_blocked', v_past_due_blocked,
    'cancelada_blocked', v_cancelada_blocked,
    'source', p_source,
    'ran_at', now()
  );
END $$;

REVOKE ALL ON FUNCTION public._apply_subscription_transitions(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._apply_subscription_transitions(uuid, text) TO service_role;
```

**Notas:**
- `FOR UPDATE SKIP LOCKED` evita contenção entre cron e lazy-check rodando concorrentemente.
- `audit_write` precisa aceitar `actor_profile_id = NULL` quando chamada sem JWT (cron). Validar/ajustar no preflight do `@db-admin`.
- Ordem de transições é fixa (trial → past_due → cancelada). Não há overlap (status disjuntos), ordem é só para consistência de leitura.

#### 3. RPC pública `admin_transition_subscriptions() returns jsonb` — wrapper para o cron

```sql
CREATE OR REPLACE FUNCTION public.admin_transition_subscriptions()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._apply_subscription_transitions(NULL, 'cron');
$$;

REVOKE ALL ON FUNCTION public.admin_transition_subscriptions() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_transition_subscriptions() TO service_role;
```

#### 4. RPC pública `admin_transition_subscription_for_org(p_org_id uuid) returns jsonb` — wrapper para lazy-check

```sql
CREATE OR REPLACE FUNCTION public.admin_transition_subscription_for_org(p_org_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._apply_subscription_transitions(p_org_id, 'lazy_middleware');
$$;

REVOKE ALL ON FUNCTION public.admin_transition_subscription_for_org(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_transition_subscription_for_org(uuid) TO service_role;
```

#### 5. Extensão pg_cron + job

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Schedule horário (top of hour). Idempotente: se job já existir, unschedule + reschedule.
SELECT cron.unschedule('admin_transition_subscriptions_hourly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'admin_transition_subscriptions_hourly');

SELECT cron.schedule(
  'admin_transition_subscriptions_hourly',
  '0 * * * *',
  $$ SELECT public.admin_transition_subscriptions(); $$
);
```

> **Risco:** pg_cron pode não estar habilitado no plano Supabase corrente. `@db-admin` checa no preflight. Fallback: Edge Function + Vercel Cron com mesmo schedule, chamando `admin_transition_subscriptions()` via service_role. **Sprint 13 implementa só o caminho pg_cron.** Fallback é runbook para virar issue ops separado se necessário.

### Existing Tables Used

#### Table: `public.subscriptions`
**Usage:** alvo das transições.
**Fields accessed:** `id`, `organization_id`, `status`, `period_end`, `updated_at`.

#### Table: `public.platform_settings`
**Usage:** lê `past_due_grace_days` (default 7).
**Fields accessed:** `key`, `value_int`.

#### Table: `public.audit_log`
**Usage:** receber rows de transição via `audit_write`.

---

## 3. API Contract

### Server Actions

Sprint 13 produz **1 Server Action nova** (não é o foco — backend é majoritariamente DB primitives + middleware).

#### `triggerLazyTransitionAction`

**File:** `src/lib/actions/subscriptionTransitions/actions.ts` (módulo novo)

> **Nota:** esta Server Action é interface fina sobre a RPC `admin_transition_subscription_for_org`. **Não é chamada por UI** — é chamada exclusivamente pelo middleware admin via helper `triggerLazyTransition(orgId)` em `src/lib/middleware/lazyTransition.ts`.

**Input Schema (Zod):**
```typescript
const LazyTransitionSchema = z.object({
  organizationId: z.string().uuid(),
});
```

**Output:** `ActionResponse<{ transitioned: number; trialExpired: number; pastDueBlocked: number; canceladaBlocked: number }>`.

**Business Logic:**
1. Validar input com Zod.
2. `auth.getUser()` — só platform admin executa lazy-check (defesa em profundidade — middleware já fez `requireAdminSession`).
3. Chamar `requirePlatformAdmin()`. Não-admin → `{ success: false, error: 'Não autorizado' }`.
4. Chamar RPC `admin_transition_subscription_for_org(organizationId)`.
5. Mapear resposta para shape camelCase + `revalidatePath('/admin/organizations/[id]', 'page')`.
6. Erro → log + `{ success: false, error: 'Falha ao atualizar status da assinatura' }`.

**Regra testável:**
- Quando o middleware admin entra em rota que toca uma subscription cuja `period_end < now()` (status `trial`), a chamada lazy flipa antes do response chegar ao usuário.

---

## 4. External API Integration

**N/A** — não há integração com API externa. Toda lógica é interna (Postgres + Next.js middleware). Configuração de DNS/Vercel é deploy ops, não integração.

---

## 5. Componentes de UI

**N/A** — Sprint 13 não cria nem modifica componentes de UI. A tela de "conta suspensa" já foi entregue no Sprint 05 (`/conta-suspensa`) e é redirect-target do middleware quando `organizations.is_active = false`. Sprint 13 apenas faz com que mais orgs caiam nesse estado automaticamente.

> **Observação:** quando `subscriptions.status` flipa para `trial_expired`/`suspensa` via cron, o customer continua acessando até o próximo request, momento em que o middleware existente (linhas 76-98 de `src/middleware.ts`) redireciona para `/conta-suspensa` se a policy `is_calling_org_active()` (Sprint 05) bloquear. **Verificar pré-execução:** `is_calling_org_active()` precisa considerar `subscriptions.status` além de `organizations.is_active`. Se hoje só olha `is_active`, este sprint inclui ajuste.

**Investigação obrigatória pelo `@db-admin` no preflight:**
```sql
SELECT pg_get_functiondef('public.is_calling_org_active()'::regprocedure);
```
Se a função só checa `is_active`, esticar para também bloquear quando `subscription.status IN ('trial_expired','suspensa')`. Senão, a transição automática não tem efeito visível no customer.

---

## 6. Edge Cases (CRITICAL)

### Transições automáticas

- [ ] **Cron rodou agora; rodar de novo no mesmo segundo:** segundo run filtra `WHERE status IN (...)` e altera 0 rows; `audit_log` não duplica.
- [ ] **Lazy-check e cron tocam mesma row simultaneamente:** `FOR UPDATE SKIP LOCKED` faz com que o segundo a chegar pule essa row. Idempotência garante consistência final.
- [ ] **Customer está em request ativo quando cron flipa:** o request em curso completa normalmente; próximo request bate na policy `is_calling_org_active()` e é redirecionado para `/conta-suspensa`. Sessão **não** é invalidada (não force-logout — é responsabilidade do customer reentrar).
- [ ] **`past_due_grace_days` não está em `platform_settings`:** função usa fallback hardcoded `7` (já validado no contexto vivo: existe seed).
- [ ] **`subscriptions.period_end IS NULL`:** linha não é elegível para transição (filtro explícito `IS NOT NULL`). Subscription "perpetua" continua intocada.
- [ ] **Cron pausado por X horas:** lazy-check no middleware admin atualiza on-demand quando admin abre a área tocando aquela org. Customer continua bloqueado pela policy independente do cron ter rodado.
- [ ] **Audit_write recusa NULL actor:** preflight do `@db-admin` ajusta a função (ou cria wrapper `audit_write_system`) ANTES da migration principal. Sem isso, todos os audits do cron falham e a transição é revertida.

### Slug imutável

- [ ] **UPDATE single-row tentando trocar slug:** trigger rejeita com `org_slug_immutable` (P0001) imediatamente. Independente de quantos logins houve.
- [ ] **UPDATE no-op (slug igual ao atual):** `NEW.slug IS DISTINCT FROM OLD.slug` é FALSE → trigger permite. Permite UPDATE de outras colunas (ex: `name`, `is_active`) sem penalidade.
- [ ] **UPDATE batch que toca várias orgs alterando slug:** trigger é per-row; a primeira row aborta a transação inteira. UI não emite update batch (operação é per-org).
- [ ] **Operador precisa renomear slug por motivo legítimo (ex: typo no setup):** sai do escopo da UI — runbook operacional manual (DROP TRIGGER → UPDATE → recreate TRIGGER, ou bypass via SECURITY DEFINER ad-hoc fora do app).

### Origin isolation

- [ ] **Request a `<customer-host>/admin/login`:** middleware retorna 404 (não 403, não redirect — não revelar existência da rota).
- [ ] **Request a `<admin-host>/dashboard` (path customer):** middleware retorna 404. Customer rotas só servidas no customer host.
- [ ] **Request a `<admin-host>/api/customer-endpoint`:** middleware retorna 404 (path não casa `/admin/*`).
- [ ] **Mesmo browser logado em ambos os contextos:** sessões coexistem em cookies de domínios distintos; logout em um não invalida o outro (RNF-SEC-1).
- [ ] **CSRF cross-origin (request originado em `<customer-host>` para action admin):** com `SameSite=Strict`, cookie de admin não é enviado → falha de auth, não execução cega (T-11).
- [ ] **Dev local (`localhost:3000` ou `127.0.0.1`):** middleware detecta host de dev e roda em modo permissivo (sem hostname gate), com warning log único. Permite continuar desenvolvendo sem subdomínio.
- [ ] **Env vars `NEXT_PUBLIC_ADMIN_HOST` / `NEXT_PUBLIC_CUSTOMER_HOST` ausentes em produção:** middleware **bloqueia** todo acesso `/admin/*` com 503 + log de erro. Hard-fail é preferível a soft-fail em produção (defesa contra deploy mal-configurado).
- [ ] **Cookie de sessão emitido por Supabase no domínio errado:** `cookies` callback do `createServerClient` do middleware força `domain` explícito conforme host atual antes de setar.

### Audit do cron

- [ ] **`audit_write` falha durante a transação do cron (ex: log_email_delivery deadlock):** transação inteira faz rollback; subscription **não** é flipada. Próxima execução tenta de novo. Garante INV-6 (audit transacional).
- [ ] **Cron consome quota de pg_cron (Supabase tier limit):** monitoramento via `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20` — runbook ops descreve.

---

## 7. Acceptance Criteria (BINARY)

### Database
- [ ] Migration roda com sucesso em staging sem erros (GATE 1).
- [ ] Migration é idempotente (rerun completo = no-op).
- [ ] Trigger `prevent_slug_change` rejeita qualquer `UPDATE slug` que troque o valor com `ERRCODE = 'P0001'` e mensagem `org_slug_immutable`.
- [ ] Trigger permite UPDATE no-op (slug igual ao atual) — não bloqueia UPDATE de outras colunas da mesma row.
- [ ] RPC `_apply_subscription_transitions(NULL, 'cron')` flipa todas as subscriptions vencidas e grava 1 audit row por transição com `metadata->>'source' = 'cron'`.
- [ ] RPC `_apply_subscription_transitions(<org_id>, 'lazy_middleware')` flipa apenas a org especificada.
- [ ] pg_cron job `admin_transition_subscriptions_hourly` está agendado (`SELECT * FROM cron.job` retorna a entrada).
- [ ] Todas as 3 RPCs novas têm: `SECURITY DEFINER`, `SET search_path = public`, REVOKE público/anon/authenticated, GRANT service_role (APRENDIZADO 2026-04-24).
- [ ] `is_calling_org_active()` bloqueia também por `subscription.status IN ('trial_expired','suspensa')`.

### Backend (middleware + Server Actions)
- [ ] `src/middleware.ts` tem hostname gate: `<customer-host>/admin/*` → 404; `<admin-host>/[non-admin]` → 404; `<admin-host>/admin/*` → flow admin atual.
- [ ] Modo dev (host = `localhost`/`127.0.0.1`/host vazio) emite warning único e roda permissivo.
- [ ] Em produção, env vars `NEXT_PUBLIC_ADMIN_HOST` e `NEXT_PUBLIC_CUSTOMER_HOST` ausentes → hard-fail 503 em qualquer rota `/admin/*`.
- [ ] Cookie de sessão admin tem `domain = <admin-host>` e `SameSite = 'Strict'`.
- [ ] Cookie de sessão customer tem `domain = <customer-host>` e `SameSite = 'Strict'`.
- [ ] Cookie admin **não** é enviado em request a `<customer-host>` (validável via curl ou DevTools).
- [ ] Server Action `triggerLazyTransitionAction` segue contrato + `requirePlatformAdmin()` check.
- [ ] Lazy-check chamado pelo middleware admin antes de servir rotas `/admin/organizations/[id]/*` (ou via outro gatilho a definir pelo `@backend`).
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.

### Tests (GATE 4.5)
- [ ] `tests/integration/subscriptionTransitions.test.ts` cobre: lazy flip de trial vencido, lazy flip de past_due excedido, lazy flip de cancelada vencida, idempotência (rerun = 0 rows), não-platform-admin rejeitado.
- [ ] `tests/integration/originIsolation.test.ts` (ou equivalente — pode ser unit do helper de hostname check) cobre: 4 combinações (customer-host × {admin-path, customer-path}) + (admin-host × {admin-path, customer-path}) + dev-host permissivo + hard-fail prod sem env.

### Guardian (GATE 4)
- [ ] **Guardian aprova o código** (gate único — Server Actions seguem padrões; sem UI, gate de design system não se aplica).

### Deploy / Ops
- [ ] Subdomínio `admin.<host>` configurado no provedor (Vercel) apontando para o mesmo deployment.
- [ ] Runbook em `docs/admin_area/runbook_origin_isolation.md` com: passos DNS, env vars produção, smoke tests `curl` esperados, rollback (apontar `admin.<host>` para nada ou flag `ADMIN_HOST_GATE_DISABLED=true` no middleware).
- [ ] `.env.example` atualizado com `NEXT_PUBLIC_ADMIN_HOST` e `NEXT_PUBLIC_CUSTOMER_HOST` documentados.

---

## 8. Implementation Plan

### Phase 1: Database (`@db-admin`)
1. Preflight: confirmar `pg_cron` extensão disponível. Se não, escalar.
2. Preflight: inspecionar `audit_write` — confirmar que aceita NULL actor; senão, ajustar.
3. Preflight: inspecionar `is_calling_org_active()` — confirmar que considera status; senão, ajustar.
4. Migration única `YYYYMMDDHHMMSS_admin_13_auto_transitions_slug_origin.sql`:
   - Trigger `prevent_slug_change` (versão simplificada — slug imutável desde criação)
   - Função privada `_apply_subscription_transitions`
   - 2 RPCs públicas (`admin_transition_subscriptions`, `admin_transition_subscription_for_org`)
   - REVOKE/GRANT em todas
   - Ajuste em `is_calling_org_active` (estende para considerar status)
   - CREATE EXTENSION pg_cron
   - Schedule do cron job (idempotente: unschedule + reschedule)
5. GATE 1: dry-run + RLS check + manual replay.

**Estimated Time:** 25-35 minutos.

### Phase 2: Backend / Middleware (`@backend`)
1. Criar `src/lib/middleware/hostnameGate.ts` — função pura `isAllowedPath(host, pathname): { allowed: boolean; reason: string }`.
2. Integrar em `src/middleware.ts` antes de qualquer outra checagem (returns 404 cedo).
3. Criar `src/lib/middleware/lazyTransition.ts` — helper para chamar `triggerLazyTransitionAction` quando middleware admin entra em rota org-scoped.
4. Customizar cookies callback do `createServerClient` para forçar `domain` + `SameSite=Strict` no setAll.
5. Criar módulo `src/lib/actions/subscriptionTransitions/` (actions.ts + schemas.ts).
6. Atualizar `.env.example`.
7. `npm run build` + `npm run lint`.

**Estimated Time:** 45-70 minutos.

### Phase 3: Integration tests (`@qa-integration`)
1. `tests/integration/subscriptionTransitions.test.ts` — 5 testes mínimos.
2. Hostname gate: unit test em `tests/unit/hostnameGate.test.ts` (helper puro, fácil) — ou integration via mock de NextRequest.

**Estimated Time:** 30-45 minutos.

### Phase 4: Frontend (`@frontend+`)
**N/A** — sprint sem UI nova.

### Phase 5: Review (`@guardian`)
1. Validar Server Actions: contrato, Zod, auth check, error handling.
2. Validar middleware: sem fail-open, env vars com hard-fail em prod.
3. Validar migration: REVOKE/GRANT, search_path, idempotência.

**Estimated Time:** 15 minutos.

### Phase 6: Runbook + Deploy ops (Tech Lead)
1. Escrever `docs/admin_area/runbook_origin_isolation.md` com DNS + env vars + smoke + rollback.
2. (Opcional, se possível em staging) configurar subdomínio teste e validar smoke.

**Estimated Time:** 25 minutos.

**Total:** 140-190 minutos (≈ 2.5-3.5 horas).

---

## 9. Risks & Mitigations

### Risk 1: pg_cron indisponível no plano Supabase atual
**Impact:** High — cron é o coração da automação; sem ele, lazy-check fica como única defesa e o SLA de 15min não é garantido.
**Probability:** Medium — extensão está listada como disponível, mas habilitação pode requerer ação manual no Dashboard.
**Mitigation:** preflight do `@db-admin` testa `CREATE EXTENSION pg_cron` em ambiente de testes. Se falhar, escala IMEDIATAMENTE ao Tech Lead com instruções de ativação no dashboard. Fallback Edge Function + Vercel Cron documentado no runbook (não implementado neste sprint).

### Risk 2: `audit_write` rejeita actor NULL
**Impact:** High — cron transition aborta na primeira row, transação reverte, nada flipa.
**Probability:** Medium — função foi escrita no Sprint 03 com actor obrigatório; updates posteriores (Sprint 09) aceitaram `target_id=NULL` mas não está claro se actor também.
**Mitigation:** preflight inspeciona definição via `pg_get_functiondef`. Se actor é `NOT NULL`, ajusta na mesma migration (with header note explícito). Alternativa: criar wrapper `audit_write_system(...)` que aceita NULL e marca em metadata.

### Risk 3: Cookie domain misconfiguration causa logout cross-context
**Impact:** Medium — usuário logado em admin é deslogado quando navega em customer (e vice-versa). UX ruim mas não-fatal.
**Probability:** Medium-High — Supabase auth helpers default não setam `domain` explícito.
**Mitigation:** override do `cookies` callback no `createServerClient` em `src/lib/supabase/middleware.ts` força `domain` correto baseado no host atual. Test: integration que valida cookie headers em response. Rollback: env var `COOKIE_DOMAIN_OVERRIDE_DISABLED=true` força fallback default.

### Risk 4: Configuração de subdomínio no Vercel exige propagação DNS
**Impact:** Medium — deploy parcial: admin gate ativa antes do DNS propagar, admins ficam sem acesso.
**Probability:** Medium.
**Mitigation:** runbook exige sequência: (1) DNS propagado e verificado via `dig`/`nslookup`; (2) deploy do middleware; (3) smoke test com curl; (4) anúncio aos admins. Rollback: variável de ambiente `ADMIN_HOST_GATE_DISABLED=true` desativa gate sem novo deploy.

### Risk 5: Race entre cron e UI admin manual
**Impact:** Low — admin clica "trocar plano" enquanto cron flipa para `trial_expired`.
**Probability:** Low.
**Mitigation:** `FOR UPDATE SKIP LOCKED` no cron evita contenção. Server Action de admin (já existente do Sprint 06) usa SELECT FOR UPDATE no `subscriptions.id`. Conflito → admin recebe `concurrent_modification` error → reload + retry manual.

---

## 10. Dependencies

### Internal
- [x] **Sprint 03 — `audit_write` RPC** existe e suporta variantes de actor (validar NULL).
- [x] **Sprint 04 — middleware admin** com `requireAdminSession`, AAL2, MFA gates (modificado pelo Sprint 11).
- [x] **Sprint 05 — `is_calling_org_active()`** policy ativa (validar se considera `subscription.status`).
- [x] **Sprint 05 — tela `/conta-suspensa`** existe.
- [x] **Sprint 09 — `platform_settings` com `past_due_grace_days`** seeded (confirmado: 7 dias).
- [x] **Sprint 11 — coluna `mfa_reset_required`** em profiles + middleware lê (não modificado por este sprint).

### External
- [ ] **Supabase tier suporta pg_cron extension** (validar no preflight).
- [ ] **Acesso ao Vercel project para configurar subdomínio** (humano executa, fora do escopo agente).
- [ ] **Acesso ao DNS provider para criar registro `admin.<host>`** (humano).

---

## 11. Rollback Plan

### Rollback de DB

```sql
-- 1. Desabilitar cron job (não destrutivo)
SELECT cron.unschedule('admin_transition_subscriptions_hourly');

-- 2. Drop das funções e trigger
DROP FUNCTION IF EXISTS public.admin_transition_subscriptions();
DROP FUNCTION IF EXISTS public.admin_transition_subscription_for_org(uuid);
DROP FUNCTION IF EXISTS public._apply_subscription_transitions(uuid, text);
DROP TRIGGER IF EXISTS prevent_slug_change ON public.organizations;
DROP FUNCTION IF EXISTS public._prevent_slug_change();

-- 3. Reverter is_calling_org_active() para versão original (snapshot pré-migration)
--    incluído no script de rollback gerado pelo @db-admin
```

### Rollback de código

```bash
git revert <commit-hash-da-sprint-13>
```

### Rollback de origin isolation (sem novo deploy)

```bash
# No painel Vercel, definir env var:
ADMIN_HOST_GATE_DISABLED=true
# Middleware lê e roda em modo permissivo (sem hostname gate).
# Próximo redeploy carrega a flag.
```

### Rollback de DNS

Apontar `admin.<host>` para `NXDOMAIN` ou para uma página de manutenção. Customer host continua funcionando normalmente.

### Verificação pós-rollback

- `SELECT * FROM cron.job` → vazio (job removido).
- `UPDATE organizations SET slug='teste' WHERE id='<org_com_first_login>'` → permite (trigger removido).
- `curl <customer-host>/admin/login` → tela de login (gate removido).

---

## Approval

**Created by:** @spec-writer (Tech Lead session, 2026-04-29)
**Reviewed by:** @sanity-checker (pendente)
**Approved by:** Edson (pendente — STOP & WAIT do workflow Opção 2)
**Date:** 2026-04-29
