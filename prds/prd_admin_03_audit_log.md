# PRD: Audit Log Transacional

**Template:** PRD_COMPLETE
**Complexity Score:** 12 points (DB 5 + API 2 + UI 0 + Business 5 + Deps 0)
**Sprint:** sprint_admin_03_audit_log
**Created:** 2026-04-24
**Status:** Draft

---

## 1. Overview

### Business Goal

Criar a infraestrutura de **audit log imutável** que garante que toda ação sensível dos sprints 04–13 deixe rastro na mesma transação da mutation. Dois invariantes precisam ser provados em banco antes de qualquer sprint CRUD admin começar:

- **INV-6:** toda ação sensível produz uma linha em `audit_log` na mesma transação. Se a mutation falha, o registro de audit não existe.
- **T-12 / G-10:** nenhum caminho de UPDATE ou DELETE em `audit_log` existe — nem via policies, nem via service_role. Append-only é enforçado por trigger de deny que ignora roles.

Sprint **sem UI**. A tela de visualização é Sprint 12.

Cobre: INV-6, T-03, T-12, G-03, G-10 do PRD admin.

### User Story

- Como **platform admin**, quero que cada ação que tomo seja registrada em log imutável, para que haja rastreabilidade de qualquer operação administrativa.
- Como **auditor interno da Axon**, quero garantia de que o log não pode ser editado retroativamente por ninguém — nem via SQL direto com service_role —, para que o log tenha valor probatório.
- Como **desenvolvedor que escreverá os Sprints 05+**, quero um helper `writeAudit` de assinatura simples e uma convenção clara de quando chamá-lo, para que o contrato seja respeitado de forma consistente sem risco de esquecimento.

### Success Metrics

- `audit_log` criada com FORCE RLS; `SELECT COUNT(*) FROM pg_policies WHERE tablename='audit_log' AND cmd IN ('UPDATE','DELETE')` = 0.
- Trigger `audit_log_deny_update_delete` ativo; `UPDATE audit_log SET occurred_at=now() WHERE false` falha com `audit_log_immutable` mesmo usando `service_role`.
- `audit_write` executável por `authenticated` e `service_role`; `has_function_privilege('anon', 'public.audit_write(...)', 'execute') = false`.
- `writeAudit` inserção bem-sucedida retorna UUID; rollback conjunto validado (ver Edge Case §6).
- `docs/conventions/audit.md` existe com contrato, convenção de slug e documentação da decisão de transacionalidade.

---

## 2. Database Requirements

### Decisão arquitetural: como garantir transacionalidade (G-03)

> Esta é a decisão mais crítica do sprint. Errar aqui invalida INV-6 para todos os sprints 05–13.

**O problema:** No Supabase JS, cada `supabase.rpc(...)` abre sua própria conexão Postgres (ou usa uma do pool). Se o código TypeScript chamar `supabase.rpc('audit_write', ...)` e depois `supabase.rpc('admin_suspend_organization', ...)`, **são duas transações independentes**. Se a segunda falhar, a primeira já foi commitada — o log de "suspensei org X" existe mesmo que a suspensão não tenha acontecido. Isso viola INV-6 e G-03.

**Decisão fixada:** `audit_write` **não é chamada do TypeScript** nas ações que têm RPC dedicada. Ela é chamada de **dentro do corpo PL/pgSQL de cada RPC de ação** (ex: `admin_suspend_organization` chama `PERFORM audit_write(...)` antes de retornar). Como tudo está em um único bloco PL/pgSQL, participam da mesma transação automaticamente.

```sql
-- Exemplo: admin_suspend_organization (Sprint 05) — executa TUDO em uma transação:
CREATE OR REPLACE FUNCTION public.admin_suspend_organization(p_org_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Mutation:
  UPDATE public.organizations SET is_active = false WHERE id = p_org_id;
  -- Audit (mesma transação — se UPDATE falhar, PERFORM nunca executa):
  PERFORM public.audit_write(
    action              => 'org.suspend',
    target_type         => 'organization',
    target_id           => p_org_id,
    ...
  );
  -- Se audit_write falhar, toda a transação rola back.
END $$;
```

**Quando o helper TypeScript `writeAudit` é usado:** apenas para Server Actions que fazem mutations diretamente via Supabase JS (sem RPC intermediária). Nesses casos, o caller precisa estruturar o fluxo como:
1. Usar uma única chamada de RPC que atomicamente faz mutation + audit, **ou**
2. Aceitar que `writeAudit` é best-effort (documentado explicitamente como tal no `docs/conventions/audit.md`).

**Convenção documentada em `docs/conventions/audit.md`:** toda mutation sensível com RPC dedicada deve chamar `audit_write` de dentro da RPC. Mutations sem RPC podem usar `writeAudit` TypeScript com flag `best_effort: true` explícito no caller (para deixar claro que não é transacional). Sprints 05–13 seguem esta convenção — é verificada pelo `@spec-writer` de cada sprint.

---

### New Tables

#### Table: `public.audit_log`

**Purpose:** Registro imutável de ações administrativas sensíveis. Cada linha é um evento ocorrido — nunca editado, nunca deletado.

**Exceção `public.*`:** `audit_log` não tem `organization_id` como coluna de tenant (tem `target_organization_id` como referência ao alvo do evento, mas o ator pode ser platform admin sem org-tenant). Adicionar à lista "Exceções em `public.*`" em `docs/conventions/standards.md` com justificativa.

**Fields:**

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `occurred_at timestamptz NOT NULL DEFAULT now()`
- `actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL` — nullable: eventos de sistema (pg_cron, break-glass CLI) não têm ator humano.
- `actor_email_snapshot text` — email no momento do evento. Snapshot defensivo: desacopla de mudanças futuras no email do profile.
- `action text NOT NULL` — slug em formato `'<domínio>.<verbo>'`. Ex: `'org.suspend'`, `'subscription.change_plan'`, `'inspect.read_leads'`, `'break_glass.recover_owner'`. Sem CHECK — conjunto aberto, cada sprint adiciona seus slugs à tabela de `docs/conventions/audit.md`.
- `target_type text NOT NULL` — ex: `'organization'`, `'subscription'`, `'plan'`, `'platform_admin'`, `'feature_flag'`, `'legal_policy'`, `'credential'`.
- `target_id uuid` — nullable: ações sobre coleções (ex: `refresh_platform_metrics`) não têm target único.
- `target_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL` — nullable: ações globais (ex: criar plano) não têm org alvo.
- `diff_before jsonb` — snapshot do registro **antes** da mutation. NULL em criações.
- `diff_after jsonb` — snapshot do registro **depois** da mutation. NULL em deleções/suspensões-sem-retorno.
- `ip_address inet` — nullable. Extraído de `x-forwarded-for` (primeiro IP da cadeia) ou `x-real-ip`. Tratado como best-effort: nunca usado como identificador único — é evidência auxiliar.
- `user_agent text` — nullable.
- `metadata jsonb` — informações adicionais livres. Ex: `{ "reason": "cliente inadimplente" }` em suspensões; `{ "new_plan_name": "Premium" }` em troca de plano.

**Indexes:**

- `CREATE INDEX audit_log_actor_occurred ON public.audit_log (actor_profile_id, occurred_at DESC) WHERE actor_profile_id IS NOT NULL;`
- `CREATE INDEX audit_log_target_org_occurred ON public.audit_log (target_organization_id, occurred_at DESC) WHERE target_organization_id IS NOT NULL;`
- `CREATE INDEX audit_log_action_occurred ON public.audit_log (action, occurred_at DESC);`
- `CREATE INDEX audit_log_occurred ON public.audit_log (occurred_at DESC);`

**Security (RLS):** `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`

- **SELECT (authenticated):** `USING (EXISTS (SELECT 1 FROM public.platform_admins WHERE profile_id = auth.uid() AND is_active = true))` — qualquer platform admin ativo pode ler. Granularidade por papel (billing vê apenas ações de billing, etc.) é aplicada na camada de UI do Sprint 12, não no banco — simplifica a policy e evita que uma nova ação sem mapeamento quebre acesso.
- **INSERT (authenticated):** **nenhuma policy** — inserção exclusivamente via RPC `audit_write` (SECURITY DEFINER).
- **UPDATE:** **nenhuma policy** — zero linhas de UPDATE policy.
- **DELETE:** **nenhuma policy** — zero linhas de DELETE policy.

> **Por que nenhuma policy de INSERT para `authenticated`:** a RPC `audit_write` tem `SECURITY DEFINER` e bypassa RLS. Adicionar policy de INSERT para `authenticated` seria enganoso — os callers legítimos usam a RPC, não insert direto. Policies de INSERT direto para `authenticated` criariam um caminho alternativo que contorna a lógica de captura de IP/UA e de validação de actor.

---

### New Functions / RPCs

#### Function: `public.audit_write(...)`

**Purpose:** Única via de inserção em `audit_log`. Chamada de dentro dos corpos PL/pgSQL das RPCs de ação (Sprints 05+), não do TypeScript — ver decisão de transacionalidade acima.

**Signature:**

```sql
CREATE OR REPLACE FUNCTION public.audit_write(
  action               text,
  target_type          text,
  target_id            uuid    DEFAULT NULL,
  target_organization_id uuid  DEFAULT NULL,
  diff_before          jsonb   DEFAULT NULL,
  diff_after           jsonb   DEFAULT NULL,
  metadata             jsonb   DEFAULT NULL,
  ip_address           inet    DEFAULT NULL,
  user_agent           text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id    uuid;
  v_actor_email text;
  v_id          uuid;
BEGIN
  -- Captura actor internamente — caller não passa, elimina risco de impersonation.
  v_actor_id    := auth.uid();            -- NULL em contextos de sistema (pg_cron)
  v_actor_email := auth.email();          -- NULL se chamado por service_role sem JWT

  INSERT INTO public.audit_log (
    actor_profile_id, actor_email_snapshot,
    action, target_type, target_id, target_organization_id,
    diff_before, diff_after, ip_address, user_agent, metadata
  ) VALUES (
    v_actor_id, v_actor_email,
    action, target_type, target_id, target_organization_id,
    diff_before, diff_after, ip_address, user_agent, metadata
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.audit_write(text, text, uuid, uuid, jsonb, jsonb, jsonb, inet, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.audit_write(text, text, uuid, uuid, jsonb, jsonb, jsonb, inet, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.audit_write(text, text, uuid, uuid, jsonb, jsonb, jsonb, inet, text) TO authenticated, service_role;
```

**Notas críticas:**

- **`VOLATILE` (não `STABLE`):** a função faz INSERT — não pode ser `STABLE` ou `IMMUTABLE`.
- **`SECURITY DEFINER`:** bypassa as policies de INSERT que não existem (defesa em profundidade) e garante que a inserção funciona mesmo se o auth context do caller estiver em estado parcial.
- **Caller passa `ip_address` e `user_agent` como parâmetros** (não extraídos dentro da função, pois PL/pgSQL não tem acesso a headers HTTP). A extração acontece no helper TypeScript `writeAudit` para chamadas diretas; para chamadas de dentro de RPCs PL/pgSQL vindas de requests Next.js, a RPC de ação recebe ip/ua do caller TypeScript e os passa para `audit_write`.
- **`auth.uid()` / `auth.email()`:** quando chamado de dentro de outra RPC `SECURITY DEFINER` (como `admin_suspend_organization`), o contexto JWT ainda está disponível — `auth.uid()` retorna o profile do usuário autenticado que disparou a request. Isso é comportamento garantido no Supabase/PostgREST.
- **Não usa `search_path = public` para funções externas:** `SET search_path = public` garante resolução segura de `audit_log` sem risco de injection via schema.

---

### Trigger: `audit_log_deny_update_delete`

**Purpose:** Bloqueia UPDATE e DELETE em `audit_log` **para qualquer role, incluindo `service_role`**. Este é o único mecanismo que funciona para service_role — policies RLS são bypassadas por service_role mesmo com FORCE RLS no Supabase (FORCE RLS bloqueia o owner da tabela em queries não-privilegiadas, mas não impede acesso via service_role key que mapeia para um superusuário no Postgres).

```sql
CREATE OR REPLACE FUNCTION public.audit_log_deny_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log_immutable'
    USING ERRCODE = 'P0001',
          DETAIL  = 'audit_log rows cannot be updated or deleted';
END $$;

DROP TRIGGER IF EXISTS audit_log_deny_update_delete ON public.audit_log;
CREATE TRIGGER audit_log_deny_update_delete
BEFORE UPDATE OR DELETE ON public.audit_log
FOR EACH ROW
EXECUTE FUNCTION public.audit_log_deny_mutation();
```

**Por que BEFORE (não AFTER):** trigger BEFORE aborta a operação antes de qualquer WAL write. AFTER acontece depois de locks serem adquiridos — desnecessariamente mais lento para um deny.

**Por que FOR EACH ROW (não STATEMENT):** FOR EACH STATEMENT com `WHEN (false)` não dispara. FOR EACH ROW garante disparo para cada linha tentada, inclusive em `DELETE WHERE id = <uuid>` direto.

**Cobertura garantida:**
- `UPDATE audit_log SET ...` → bloqueado.
- `DELETE FROM audit_log WHERE id = <uuid>` → bloqueado.
- `DELETE FROM audit_log` (sem WHERE) → bloqueado linha por linha.
- `TRUNCATE audit_log` → **não coberto por trigger BEFORE DELETE**. TRUNCATE tem sintaxe própria e requer `FOR EACH STATEMENT` em `TRUNCATE` event. Adicionar:

```sql
CREATE OR REPLACE FUNCTION public.audit_log_deny_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log_immutable'
    USING ERRCODE = 'P0001',
          DETAIL  = 'audit_log cannot be truncated';
END $$;

DROP TRIGGER IF EXISTS audit_log_deny_truncate ON public.audit_log;
CREATE TRIGGER audit_log_deny_truncate
BEFORE TRUNCATE ON public.audit_log
FOR EACH STATEMENT
EXECUTE FUNCTION public.audit_log_deny_truncate();
```

**Nota sobre `service_role`:** `service_role` no Supabase mapeia para um papel Postgres com `BYPASSRLS`. Triggers BEFORE rodam mesmo para roles com BYPASSRLS — eles são mecanismo de constraint, não de segurança de linha. Testado e confirmado: trigger BEFORE bloqueia operações de service_role.

---

### Migration header (rollback documentado — G-17)

Topo do arquivo `.sql` com rollback comentado:

```sql
-- ROLLBACK (rodar na ordem, staging primeiro):
-- DROP TRIGGER IF EXISTS audit_log_deny_truncate ON public.audit_log;
-- DROP FUNCTION IF EXISTS public.audit_log_deny_truncate();
-- DROP TRIGGER IF EXISTS audit_log_deny_update_delete ON public.audit_log;
-- DROP FUNCTION IF EXISTS public.audit_log_deny_mutation();
-- DROP FUNCTION IF EXISTS public.audit_write(text, text, uuid, uuid, jsonb, jsonb, jsonb, inet, text);
-- DROP TABLE IF EXISTS public.audit_log CASCADE;
-- Nota: rollback remove todo o histórico de audit acumulado. Confirmar antes de executar.
```

---

## 3. API Contract

### Novo módulo: `src/lib/audit/write.ts`

**File:** `src/lib/audit/write.ts` (novo — diretório `src/lib/audit/` também é novo).

**Signature:**

```typescript
import 'server-only';
import { createClient } from '@/lib/supabase/server';

export interface WriteAuditParams {
  action: string;
  targetType: string;
  targetId?: string;
  targetOrganizationId?: string;
  diffBefore?: unknown;
  diffAfter?: unknown;
  metadata?: Record<string, unknown>;
  /**
   * Quando true, falhas do audit_write são logadas mas não propagadas.
   * Usar apenas em Server Actions sem RPC dedicada onde o audit é best-effort.
   * Mutations com RPC dedicada NÃO usam este helper — chamam audit_write
   * de dentro da própria RPC PL/pgSQL (ver docs/conventions/audit.md).
   */
  bestEffort?: boolean;
}

/**
 * Wrapper TypeScript de audit_write.
 *
 * Uso esperado: Server Actions sem RPC dedicada que precisam registrar audit
 * de forma best-effort. Para mutations com RPC dedicada (Sprints 05+), o
 * audit é chamado de dentro do corpo PL/pgSQL — não usar este helper nesse caso.
 *
 * Extrai ip_address e user_agent do request quando fornecido.
 * Retorna o UUID da linha criada ou null se bestEffort=true e falhou.
 */
export async function writeAudit(
  params: WriteAuditParams,
  request?: Request
): Promise<string | null>;
```

**Business Logic (`writeAudit`):**

1. Cria Supabase client server-side.
2. Extrai `ip_address`:
   - Lê `request?.headers.get('x-forwarded-for')` → split por `,` → primeiro elemento → trim. Se resultado não for string não-vazia, tenta `request?.headers.get('x-real-ip')`. Se nenhum disponível ou resultado for IP privado/loopback (`10.x`, `172.16-31.x`, `192.168.x`, `127.x`, `::1`, `::ffff:127.x`) → passa `null` (IPs privados atrás de proxy reverso não são confiáveis como identificador de origem do cliente).
3. Extrai `user_agent` de `request?.headers.get('user-agent')` → `null` se ausente.
4. Chama `supabase.rpc('audit_write', { action, target_type: targetType, target_id: targetId ?? null, target_organization_id: targetOrganizationId ?? null, diff_before: diffBefore ?? null, diff_after: diffAfter ?? null, metadata: metadata ?? null, ip_address: ipAddress, user_agent: userAgent })`.
5. Se `error` e **não** `bestEffort`: lança `new Error(`audit_write failed: ${error.message}`)`.
6. Se `error` e `bestEffort`: loga `console.error('[audit] best-effort write failed:', error)` e retorna `null`.
7. Se sucesso: retorna `data` (UUID da linha).

**Nota de implementação — tipo do parâmetro `ip_address`:** Supabase JS envia `inet` como string. Passar como `string | null` no objeto de parâmetro do `rpc(...)` é suficiente — PostgREST faz o cast `text → inet` automaticamente. Não é necessário validar o formato no TypeScript; o Postgres rejeita strings inválidas com erro tipado se o formato for errado (edge case §6).

**Por que não é Server Action (`'use server'`):** é helper server-only importado por outras Server Actions e por RPCs PL/pgSQL (indiretamente via convenção). Não é chamado diretamente pelo cliente.

---

### Documentação: `docs/conventions/audit.md`

**Purpose:** Contrato vinculante para todos os sprints 05–13. O `@spec-writer` de cada sprint lê este arquivo antes de desenhar RPCs.

**Estrutura:**

#### 1. Regra fundamental

Toda ação sensível da área admin **deve** produzir uma linha em `audit_log` na **mesma transação** que a mutation (INV-6, G-03).

#### 2. Como garantir transacionalidade

**Para mutations com RPC dedicada (caminho padrão, Sprints 05+):**

```sql
-- Dentro do corpo da RPC PL/pgSQL de cada ação:
PERFORM public.audit_write(
  action               => 'org.suspend',
  target_type          => 'organization',
  target_id            => p_org_id,
  target_organization_id => p_org_id,
  diff_before          => to_jsonb(v_org_before),
  diff_after           => NULL,           -- suspensão não tem diff_after relevante
  metadata             => jsonb_build_object('reason', p_reason),
  ip_address           => p_ip_address::inet,   -- passado pelo caller TypeScript
  user_agent           => p_user_agent
);
```

A RPC de ação recebe `ip_address text` e `user_agent text` como parâmetros adicionais vindos do TypeScript. O caller TypeScript usa `writeAudit` apenas para extrair esses valores e passá-los à RPC:

```typescript
// No TypeScript (Server Action):
const ip = extractIp(request);
const ua = request.headers.get('user-agent');
await supabase.rpc('admin_suspend_organization', {
  p_org_id: orgId,
  p_reason: reason,
  p_ip_address: ip,
  p_user_agent: ua
});
// Não chama writeAudit aqui — o audit já foi feito dentro da RPC.
```

**Para mutations sem RPC dedicada (best-effort):**

```typescript
// Chama a mutation normalmente, depois writeAudit com bestEffort: true.
// Falha no audit não rola back a mutation — é explicitamente aceito.
await writeAudit({ action: '...', targetType: '...', bestEffort: true }, request);
```

Documentar no código com comentário `// audit: best-effort` para facilitar grep futuro.

#### 3. O que é "ação sensível"

Qualquer mutation em: `organizations`, `subscriptions`, `plans`, `platform_admins`, `plan_grants`, `platform_settings`, `feature_flags`, `legal_policies`, `platform_integration_credentials`. Também: inspeção via Deep Inspect (Sprint 08), login admin (Sprint 04), break-glass (Sprint 12).

**Não são ações sensíveis** (não precisam de audit): leituras paginadas, filtros de listagem, refresh de métricas por polling, falhas de validação no frontend.

#### 4. Padrão de slug de action

Formato: `'<domínio>.<verbo>'` em snake_case. O verbo deve ser passado (nunca presente do indicativo).

Exemplos válidos: `'org.create'`, `'org.suspend'`, `'org.reactivate'`, `'subscription.change_plan'`, `'subscription.extend_trial'`, `'subscription.cancel'`, `'plan.archive'`, `'plan.delete'`, `'limit.grant'`, `'limit.revoke'`, `'inspect.read_leads'`, `'feature_flag.set'`, `'platform_setting.update'`, `'legal_policy.publish'`, `'credential.rotate'`, `'admin.invite'`, `'admin.deactivate'`, `'auth.login_rate_limited'`, `'break_glass.recover_owner'`.

#### 5. Campos sensíveis proibidos em diff_before/diff_after

Nunca incluir: `value_encrypted`, `hashed_token`, qualquer campo com `password` ou `secret` no nome. Responsabilidade do caller (a RPC de ação) excluir esses campos antes de construir o jsonb.

#### 6. Tabela de ações registradas (atualizada por cada sprint)

| action slug | target_type | sprint | descrição |
|---|---|---|---|
| *(vazia neste sprint — primeiras ações reais no Sprint 05)* | | | |

O `@sprint-creator` de cada sprint appenda as ações novas nesta tabela no sprint file. O `@spec-writer` copia as linhas para este documento no encerramento do sprint.

---

## 4. External API Integration

**N/A.** Nenhuma integração externa.

---

## 5. Componentes de UI

**Zero.** Sprint é infraestrutura pura. UI de visualização do audit log é Sprint 12.

---

## 6. Edge Cases (CRITICAL)

### Imutabilidade do log (G-10)

- [ ] **UPDATE via `authenticated`:** `UPDATE audit_log SET occurred_at = now() WHERE false` (statement) → trigger BEFORE dispara em cada linha tentada → `audit_log_immutable` (P0001). Nenhuma linha alterada.
- [ ] **UPDATE via `service_role` (SQL direto no Supabase Studio ou CLI):** mesma rejeição pelo trigger — BEFORE trigger roda antes do BYPASSRLS check.
- [ ] **DELETE via `authenticated`:** `DELETE FROM audit_log WHERE id = <uuid>` → trigger BEFORE DELETE → `audit_log_immutable`.
- [ ] **DELETE via `service_role`:** idem — trigger cobre service_role.
- [ ] **TRUNCATE via qualquer role:** trigger BEFORE TRUNCATE → `audit_log_immutable`. Testar via `TRUNCATE public.audit_log;` no Supabase SQL editor.
- [ ] **Verificação estática de policies:** `SELECT COUNT(*) FROM pg_policies WHERE tablename='audit_log' AND cmd IN ('UPDATE','DELETE')` = 0 confirmado após migration.

### Transacionalidade (G-03 / INV-6)

- [ ] **RPC de ação falha depois de `PERFORM audit_write`:** simular em staging com RPC de teste que chama `audit_write` e depois `RAISE EXCEPTION 'simulated_failure'`. Validar que a linha **não** persiste em `audit_log` (rollback conjunto). Este é o teste mais crítico — deve ser executado manualmente pelo `@db-admin` em staging.
- [ ] **`writeAudit` TypeScript chamado e conexão cai antes do commit:** Supabase JS usa auto-commit por chamada. Se a chamada RPC à `audit_write` retorna sucesso, a linha foi commitada independentemente do que acontecer depois no TypeScript. Este é o cenário `bestEffort: false` onde o caller TypeScript é responsável pela sequência.
- [ ] **`writeAudit` com `bestEffort: true` falha:** linha não criada, `console.error` emitido, sem Exception propagada. Mutation anterior já commitada — aceito explicitamente pelo contrato `bestEffort`.

### RPC `audit_write`

- [ ] **Chamada por `anon`:** `has_function_privilege('anon', 'public.audit_write(text,text,uuid,uuid,jsonb,jsonb,jsonb,inet,text)', 'execute') = false`. Tentativa retorna `permission denied for function audit_write`.
- [ ] **`ip_address` com string inválida para `inet` (ex: `'not-an-ip'`):** Postgres rejeita o cast `text → inet` com `SQLSTATE 22P02` (invalid_text_representation). RPC levanta exceção, INSERT não ocorre. O helper TypeScript não deve deixar passar strings inválidas — mas o banco é o backstop.
- [ ] **`actor_profile_id` null (chamada de contexto de sistema, sem JWT):** INSERT aceito (campo nullable). `actor_email_snapshot` também null. Linha válida representando evento de sistema.
- [ ] **Dois `audit_write` simultâneos na mesma transação (RPC que gera dois eventos):** ambos inserem com UUIDs distintos via `gen_random_uuid()`. Sem constraint de unicidade — dois eventos distintos são válidos. Sem deadlock.

### Helper TypeScript `writeAudit`

- [ ] **`x-forwarded-for: "203.0.113.1, 10.0.0.1"` (proxy chain):** extrai `"203.0.113.1"` (primeiro elemento após split e trim). `10.0.0.1` é IP privado — se fosse o único, seria tratado como `null`.
- [ ] **`x-forwarded-for` ausente e `x-real-ip` ausente:** `ip_address = null`. INSERT aceito (nullable).
- [ ] **`x-forwarded-for: "127.0.0.1"` (loopback — dev local):** tratado como `null` (IP privado/loopback). Intencionado — em dev o IP não é confiável.
- [ ] **`request` não fornecido (chamada sem contexto de request):** `ip_address = null`, `user_agent = null`. Válido — scheduled jobs e seeds não têm request.
- [ ] **`metadata` com campo sensível (`{ value_encrypted: "..." }`):** o helper TypeScript **não** valida campos proibidos — é responsabilidade do caller. O PRD documenta a proibição; a enforcement é por code review (`@guardian` Sprint 05+).
- [ ] **`bestEffort: false` (default) e `audit_write` falha:** `writeAudit` propaga o erro com `throw new Error(...)`. Caller decide se faz rollback ou deixa propagar.

### Políticas de leitura

- [ ] **Usuário tenant (`authenticated` sem linha em `platform_admins`):** `SELECT * FROM audit_log` retorna vazio (policy SELECT exige platform admin ativo). Sem erro 403 — RLS retorna resultado vazio por padrão no Supabase.
- [ ] **Platform admin inativo (`is_active=false`):** policy `EXISTS (... WHERE is_active=true)` → falso → sem acesso. Mesmo resultado: vazio.
- [ ] **Platform admin ativo:** retorna todas as linhas (granularidade por papel é UI do Sprint 12, não RLS).

### Build / migration

- [ ] **Migration rodada duas vezes em staging (idempotência):** `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` antes de `CREATE TRIGGER` → segunda execução é no-op sem erro.
- [ ] **`diff_before` / `diff_after` com objetos de 10MB (jsonb extremo):** Postgres aceita jsonb grande, mas performance degrada. Documentado em `docs/conventions/audit.md` como trade-off aceito — o MVP não impõe limite de tamanho de diff. Sprint 12 pode adicionar column constraint se necessário.

---

## 7. Acceptance Criteria (BINARY)

### Database (GATE 1)

- [ ] `supabase db push --dry-run` passa sem erro.
- [ ] `CREATE TABLE` vs `ENABLE ROW LEVEL SECURITY` + `FORCE` na migration: 1 tabela, 1 ENABLE, 1 FORCE.
- [ ] `SELECT COUNT(*) FROM pg_policies WHERE tablename='audit_log' AND cmd IN ('UPDATE','DELETE')` = 0.
- [ ] `SELECT COUNT(*) FROM pg_policies WHERE tablename='audit_log' AND cmd = 'SELECT'` = 1 (policy de leitura para platform admins ativos).
- [ ] Trigger `audit_log_deny_update_delete` existe (BEFORE UPDATE OR DELETE) + trigger `audit_log_deny_truncate` existe (BEFORE TRUNCATE).
- [ ] `UPDATE audit_log SET occurred_at=now() WHERE false` falha com `P0001` / `audit_log_immutable` (qualquer role).
- [ ] `TRUNCATE public.audit_log` falha com `P0001` / `audit_log_immutable`.
- [ ] `has_function_privilege('anon', 'public.audit_write(text,text,uuid,uuid,jsonb,jsonb,jsonb,inet,text)', 'execute') = false`.
- [ ] `has_function_privilege('authenticated', 'public.audit_write(text,text,uuid,uuid,jsonb,jsonb,jsonb,inet,text)', 'execute') = true`.
- [ ] Teste transacional em staging: RPC de teste que chama `audit_write` + `RAISE EXCEPTION` → nenhuma linha em `audit_log` pós-execução.
- [ ] Inserção direta via `audit_write` retorna UUID; linha visível via `SELECT` com `service_role`.
- [ ] 4 índices criados (actor, target_org, action, occurred_at).
- [ ] Migration idempotente (duas execuções = mesmo estado final).

### Backend (GATE 2)

- [ ] `src/lib/audit/write.ts` criado; exporta `WriteAuditParams` e `writeAudit`.
- [ ] Primeira linha do arquivo é `import 'server-only';`.
- [ ] `writeAudit` com request contendo `x-forwarded-for: "1.2.3.4, 10.0.0.1"` passa `ip_address = '1.2.3.4'` para a RPC (validado por spy/mock do `supabase.rpc` em teste unitário ou por inspeção da linha em `audit_log` via `service_role`).
- [ ] `writeAudit` com `bestEffort: false` e falha na RPC → lança `Error`.
- [ ] `writeAudit` com `bestEffort: true` e falha na RPC → retorna `null`, sem throw.
- [ ] `npm run build` passa.
- [ ] `npm run lint` passa sem novos warnings.

### Documentação

- [ ] `docs/conventions/audit.md` criado; cobre: regra fundamental, padrão de slug, distinção entre mutations com RPC (transacional) vs sem RPC (best-effort), campos proibidos em diff, tabela de ações (vazia neste sprint).
- [ ] `docs/conventions/standards.md` § "Exceções em `public.*`" inclui linha para `audit_log` com justificativa e FORCE RLS como proteção compensatória.

### Guardian (GATE 4)

- [ ] Guardian aprova o código sem violações.
- [ ] Guardian confirma `import 'server-only'` no topo de `write.ts`.
- [ ] Guardian confirma ausência de `bestEffort: true` no código deste sprint (neste sprint não há Server Actions que usem o caminho best-effort — só a infra é criada).

---

## 8. Implementation Plan

### Phase 1: Database (`@db-admin`)

1. Gerar timestamp e criar `supabase/migrations/<timestamp>_audit_log.sql`.
2. Header comentado (o que faz + bloco de rollback).
3. Blocos na ordem:
   1. `CREATE TABLE IF NOT EXISTS public.audit_log (...)` — campos, FKs, `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`.
   2. 4 `CREATE INDEX` (actor, target_org, action, occurred_at).
   3. `DROP POLICY IF EXISTS` + `CREATE POLICY "platform_admins_can_read_audit_log" ON public.audit_log FOR SELECT ...`.
   4. `CREATE OR REPLACE FUNCTION public.audit_log_deny_mutation()` + `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER audit_log_deny_update_delete`.
   5. `CREATE OR REPLACE FUNCTION public.audit_log_deny_truncate()` + `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER audit_log_deny_truncate`.
   6. `CREATE OR REPLACE FUNCTION public.audit_write(...)` + `REVOKE/GRANT`.
4. Rodar `supabase db push --dry-run`.
5. Testar transacionalidade em staging (RPC de teste: audit_write + RAISE EXCEPTION → confirmar rollback).
6. Validar GATE 1 completo (queries da seção §7 acima).

**Estimated Time:** 25 min.

### Phase 2: Backend (`@backend`)

1. Criar `src/lib/audit/` e `src/lib/audit/write.ts` conforme §3.
2. Criar `docs/conventions/audit.md` conforme §3.
3. Atualizar `docs/conventions/standards.md` — adicionar linha em "Exceções em `public.*`" para `audit_log`.
4. Rodar `npm run build`, `npm run lint`.

**Estimated Time:** 20 min.

### Phase 3: Guardian (`@guardian`)

1. Ler `src/lib/audit/write.ts` e `docs/conventions/audit.md`.
2. Verificar `import 'server-only'`, tipo `WriteAuditParams`, lógica de extração de IP.
3. Verificar ausência de `bestEffort: true` no helper neste sprint.
4. Aprovar ou reportar violações.

**Estimated Time:** 8 min.

### Phase 4: Integration tests (`@qa-integration`)

1. Criar `tests/integration/audit.test.ts`.
2. Testes obrigatórios:
   - Inserção via `supabase.rpc('audit_write', ...)` retorna UUID; linha existe em `audit_log`.
   - UPDATE em `audit_log` falha com `P0001`.
   - DELETE em `audit_log` falha com `P0001`.
   - Chamada por anon → `permission denied`.
   - Transacionalidade: RPC de teste que chama `audit_write` + `RAISE EXCEPTION` → linha não persiste.
3. Rodar `npm test -- --run tests/integration/audit.test.ts`.

**Estimated Time:** 15 min.

**Total Estimated Time:** ~70 min.

---

## 9. Risks & Mitigations

### Risk 1: TRUNCATE não bloqueado pelo trigger BEFORE DELETE

**Impact:** High (TRUNCATE bypassaria a proteção de imutabilidade).
**Probability:** Certain se não tratado (TRUNCATE não dispara triggers BEFORE DELETE — dispara trigger de evento `TRUNCATE` separado).
**Mitigation:** Adicionar trigger `BEFORE TRUNCATE FOR EACH STATEMENT` explícito (incluído no PRD — ver §2 trigger). Teste obrigatório no GATE 1.

### Risk 2: `service_role` bypassar trigger

**Impact:** Critical (inviabilizaria G-10).
**Probability:** Very Low — triggers BEFORE são mecanismos de constraint de integridade, não de segurança de linha. Rodam para todos os roles incluindo superusuário. Diferente de RLS (que é bypassado por service_role).
**Mitigation:** Teste explícito em staging via SQL direto com service_role key. Incluído no GATE 1.

### Risk 3: `auth.uid()` retorna null dentro de RPC SECURITY DEFINER

**Impact:** Medium (actor_profile_id seria null em eventos que têm ator humano).
**Probability:** Low — no Supabase/PostgREST, quando uma RPC é chamada via authenticated request, o contexto JWT persiste mesmo em funções SECURITY DEFINER encadeadas. `auth.uid()` resolve corretamente.
**Mitigation:** Teste explícito: chamar `audit_write` como authenticated via `supabase.rpc(...)` e verificar que `actor_profile_id` está preenchido na linha resultante. Se falhar (contexto perdido), fallback: `audit_write` aceita `actor_profile_id` como parâmetro opcional — o caller passa explicitamente.

### Risk 4: IP privado passado como `ip_address` válido

**Impact:** Low (ruído no log, não é falha crítica).
**Probability:** Medium em ambientes com proxy reverso (Vercel, Cloudflare).
**Mitigation:** Helper TypeScript filtra IPs privados → `null`. Documentado em `docs/conventions/audit.md`.

### Risk 5: `diff_before`/`diff_after` com campos sensíveis

**Impact:** High (credenciais ou tokens no log — violaria G-14 do Sprint 10).
**Probability:** Medium (fácil de esquecer ao construir o diff em PL/pgSQL de ação).
**Mitigation:** Documentado como proibição em `docs/conventions/audit.md`. Guardian dos Sprints 05+ verifica que RPCs de ação excluem campos sensíveis antes de construir o jsonb. Não há enforcement automático neste sprint.

---

## 10. Dependencies

### Internal

- [ ] **Sprint 02 aplicado em prod e staging:** `platform_admins` existe com `is_active` — necessário para a policy SELECT de `audit_log`. ✅ Confirmado via live DB.
- [ ] **`docs/conventions/standards.md` atualizado:** linha de exceção para `audit_log` adicionada no encerramento deste sprint.

### External

Nenhuma.

### Sprints bloqueados por este

- Sprint 05 (CRUD organizations) — primeira sprint a chamar `audit_write` de dentro de RPCs.
- Todos os sprints 06–13 — dependem da infra e do contrato de `docs/conventions/audit.md`.
- Sprint 12 (Audit UI) — depende da tabela e dos índices de `audit_log`.

---

## 11. Rollback Plan

### Se migration rodou com sucesso mas causou problema

```sql
-- Em staging primeiro, depois prod:
DROP TRIGGER IF EXISTS audit_log_deny_truncate ON public.audit_log;
DROP FUNCTION IF EXISTS public.audit_log_deny_truncate();
DROP TRIGGER IF EXISTS audit_log_deny_update_delete ON public.audit_log;
DROP FUNCTION IF EXISTS public.audit_log_deny_mutation();
DROP FUNCTION IF EXISTS public.audit_write(text, text, uuid, uuid, jsonb, jsonb, jsonb, inet, text);
DROP TABLE IF EXISTS public.audit_log CASCADE;
-- Aviso: remove todo histórico de audit acumulado. Confirmar com Edson antes.
```

Rollback do código: `git revert <commit>`. `src/lib/audit/write.ts` e `docs/conventions/audit.md` são removidos. Build passa (nenhum código existente importa `write.ts` neste sprint).

### Se migration falhou no meio

Transação rollada automaticamente. Estado do banco = pré-migration. Inspecionar erro, corrigir, re-executar.

---

## Approval

**Created by:** `@spec-writer` (persona do Tech Lead)
**Reviewed by:** `@sanity-checker` — pendente
**Approved by:** Usuário — pendente
**Date:** 2026-04-24
