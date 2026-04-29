# Sprint admin_12: Audit log UI + rate limit login admin + break-glass CLI

> **Nível:** STANDARD
> **Ciclo:** Admin Area · Sprint 12 de 13
> **Plano fonte:** [`docs/admin_area/sprint_plan.md`](../../docs/admin_area/sprint_plan.md) § Sprint 12
> **PRD fonte:** [`docs/admin_area/admin_area_prd.md`](../../docs/admin_area/admin_area_prd.md) § RF-AUTH-4, RF-AUDIT-1..6, RF-ADMIN-8, RNF-SEC-8, RNF-OBS-2, RNF-UX-2, INV-10, G-13, G-21, T-07, T-12, T-20
> **Dependências satisfeitas:** sprint_admin_03 ✅ (`audit_log` + RPC `audit_write` + triggers `audit_log_deny_mutation`/`audit_log_deny_truncate` + helper `writeAudit`) · sprint_admin_04 ✅ (`/admin/login`, middleware `requireAdminSession`, AAL2 enforcement) · sprint_admin_02 ✅ (`platform_admins`, `requirePlatformAdmin`/`requirePlatformAdminRole`, RBAC matrix) · sprint_admin_05..11 ✅ (corpus de ações sensíveis já populando `audit_log`: org/subscription/plan/grant/inspect/settings/integration_credential/platform_admin)
> **Dependências NÃO satisfeitas (intencional):** Sprint 13 (transições automáticas via pg_cron + origin isolation deploy) acontece depois — Sprint 12 não depende, mas o slug `subscription.auto_expire` que o cron 13 emitirá já será visível na UI assim que disparar.
> **Estado do banco consultado direto via MCP** — não usar `docs/schema_snapshot.json`.

---

## 🎯 Objetivo de Negócio

Fechar a malha de **observabilidade operacional + recuperação de emergência** da plataforma admin. Hoje, depois do Sprint 11, todo o corpus de ações sensíveis (CRUD orgs/subs/plans/admins/grants/credenciais + inspect read-only + password reset + step-up MFA) já grava em `audit_log` na mesma transação (INV-6) — mas **não há UI para consultar** o que foi gravado, nenhum **rate limit** protegendo a Server Action de login admin contra brute force, e nenhum **procedimento formal de recuperação** se o último owner ativo for desativado por engano ou todos os admins perderem MFA simultaneamente.

Três superfícies independentes entram em produção neste sprint:

1. **Audit log UI (`/admin/audit`)** — listagem paginada com filtros por admin, ação, entidade, organização alvo e período; detalhe com diff JSON pretty-printed e metadados completos. RBAC: `owner`/`support` veem tudo; `billing` vê apenas slugs de domínio comercial (plans/subscriptions/grants/organization). Performance dentro de RNF-PERF-2 (<500ms) com dataset representativo via índices dedicados.
2. **Rate limit login admin (G-13, T-07)** — tabela `login_attempts_admin` registra todas as tentativas (sucesso+falha) com email/IP/ocorrência; middleware sliding-window aplica os limites do plano (5 falhas em 10min por email **+** 20 falhas em 10min por IP) **antes** da chamada a `supabase.auth.signInWithPassword`; atingido o limite, retorna 429 e grava audit `auth.login_rate_limited` com metadata. Login bem-sucedido grava audit `auth.login_admin_success` (RF-AUDIT-1 trata login admin como ação sensível); login falho grava apenas em `login_attempts_admin` para preservar volume.
3. **Break-glass CLI (`scripts/break-glass.ts`, G-21, T-20, INV-10)** — script versionado executável fora do app (`tsx scripts/break-glass.ts <email>`); requer **simultaneamente** `SUPABASE_SERVICE_ROLE_KEY` + `BREAK_GLASS_SECRET` (env var separada, cofre distinto) + email do alvo + confirmação digitada do email no prompt (RNF-UX-2); operação: upsert idempotente em `platform_admins (role='owner', is_active=true)` para o profile do email indicado, unenroll de **todos** os factors TOTP existentes, set `profiles.mfa_reset_required=true` (consumido por Sprint 11 no próximo login → força re-enroll), grava audit `break_glass.recover_owner` com `metadata.operator` (variável `BREAK_GLASS_OPERATOR` obrigatória) + IP/host. Runbook em `docs/admin_area/runbook_break_glass.md` documenta cofres separados e cadência de rotação distinta de `BREAK_GLASS_SECRET` vs service role.

Esta sprint **não entrega**: política de retenção implementada (apenas a coluna `audit_log.retention_expires_at` reservada — D-7 é decisão a fixar mas o purge job fica para fase 2); rate limit no customer app (Sprint 12 cobre apenas `/admin/login`); export CSV do audit (fora de escopo MVP); dashboard de tentativas falhadas (apenas tabela, leitura via SQL no MVP).

**Métrica de sucesso:**
- Owner abre `/admin/audit`, filtra por `action=org.suspend` em janela de 7 dias, vê linhas paginadas em <500ms com 100k linhas seedadas (RNF-PERF-2).
- 6ª tentativa de login para `email=foo@axon.io` em 10min retorna `429` + linha em `audit_log` com `action='auth.login_rate_limited'` e `metadata={email_hash, ip, attempts_count, window_start}` (G-13). Email **não** é gravado em texto puro no audit (privacidade) — apenas o hash SHA-256 + `actor_email_snapshot` ausente (login falhou antes de identificar profile).
- 21ª tentativa do mesmo IP contra emails distintos em 10min retorna `429` + linha em audit (mesma action, `metadata.scope='ip'`).
- `tsx scripts/break-glass.ts edsonmmiranda@gmail.com` sem `BREAK_GLASS_SECRET` no env falha com mensagem clara `"BREAK_GLASS_SECRET missing"` **antes** de qualquer write no banco (T-20 / G-21 — fail-closed).
- Execução completa do CLI (env válida + confirmação digitada do email correto) cria/reativa entrada em `platform_admins` + invalida factors TOTP + grava audit `break_glass.recover_owner` na **mesma transação** do upsert (INV-10).
- RBAC validado em UI: usuário com role `billing` que abre `/admin/audit` vê **apenas** linhas com `action LIKE 'plan.%' OR action LIKE 'subscription.%' OR action LIKE 'grant.%' OR action LIKE 'org.%'` — slugs de admin/settings/integration_credential ficam fora do recordset.

---

## 👤 User Stories

- Como **platform admin owner**, quero abrir `/admin/audit` e filtrar por admin/ação/organização/período para responder rapidamente "quem suspendeu a org X em terça?".
- Como **platform admin support**, quero ver o audit completo (incluindo CRUD de admins e settings), pois sou o primeiro a investigar quando um cliente reporta "alguém da Axon mexeu no meu cadastro".
- Como **platform admin billing**, quero ver apenas o histórico de plans/subscriptions/grants — não preciso (e não deveria, por minimização de privilégio) ver criação de admins ou rotação de credencial de email.
- Como **auditor de segurança**, quero abrir uma linha do audit e ver `diff_before` e `diff_after` formatados em JSON legível com ênfase nos campos que mudaram, para reconstituir exatamente o que aconteceu.
- Como **time de SRE**, quero que tentativas brute-force contra `/admin/login` sejam bloqueadas em até 5 falhas/email em 10min sem precisar de WAF externo configurado por subdomínio admin.
- Como **operador de incidente**, quero ver `login_attempts_admin` (via SQL no MVP) para diagnosticar de onde vem o ataque (concentração de IPs, distribuição de emails alvejados).
- Como **operador de incidente em lockout total** (último owner desativado E sem acesso a MFA), quero rodar `tsx scripts/break-glass.ts <email>` numa máquina com acesso ao Supabase de produção e ter meu acesso owner restaurado em <30s — mas o sistema **deve** rejeitar a execução se o segundo segredo não estiver configurado.
- Como **dev em produção**, quero que cada execução de break-glass deixe rastro identificável (qual variável `BREAK_GLASS_OPERATOR` foi usada, qual IP/host, qual email-alvo) para detectar uso indevido — mesmo que o atacante tenha as duas credenciais, a execução é silenciosa apenas em `audit_log`, **não** invisível.
- Como **admin recém-recuperado por break-glass**, quero ser forçado a re-enrollar MFA no próximo login (Sprint 11 já cobre via `mfa_reset_required=true`) — o break-glass **não** restaura factor antigo, força recriação.

---

## 🎨 Referências Visuais

- **Layout admin:** já existe — `src/app/admin/layout.tsx` + `src/components/admin/AdminShell.tsx`. Sprint adiciona rotas novas sob `/admin/audit`.
- **Página `/admin/audit` (lista):** padrão de listagem do Sprint 09 (settings) + Sprint 05 (organizations) + Sprint 11 (admins). Layout:
  - **Filtros no topo** (collapse em mobile): `admin` (search por nome/email com autocomplete via `auth.users`+`profiles`), `action` (multi-select com agrupamento por prefixo: `org.*`, `subscription.*`, `plan.*`, `grant.*`, `inspect.*`, `platform_admin.*`, `password_reset.*`, `auth.*`, `settings.*`, `feature_flag.*`, `legal_policy.*`, `integration_credential.*`, `email.*`, `metrics.*`, `break_glass.*`), `target_organization_id` (search por nome/slug — só orgs reais), `period` (preset: 24h/7d/30d/custom; custom → date range picker), `target_type` (select).
  - **Tabela paginada** com colunas: `Quando` (relativo + tooltip absoluto), `Quem` (avatar + nome ou "—" se actor_profile_id NULL), `Ação` (badge colorido por categoria — verde para `*.create`, amarelo para `*.update`/`*.role_change`, vermelho para `*.delete`/`*.suspend`/`*.revoke`/`*.deactivate`/`break_glass.*`/`auth.login_rate_limited`), `Alvo` (target_type + nome/id resolvido), `Org` (nome ou "—"), `IP` (truncado, copiável). Linhas clicáveis → drawer de detalhe.
  - **Paginação cursor-based** (50 por página) — keyset (`occurred_at, id`) descendente; `Carregar mais` no fim.
  - **Empty state:** ilustração + "Nenhuma linha de audit no filtro atual" + sugestão "Limpar filtros".
- **Drawer de detalhe `/admin/audit/[id]`** (URL bookmarcable): renderiza row inteira:
  - **Header:** ação (badge), timestamp absoluto + relativo, ator (nome + email snapshot), alvo (link clicável quando `target_type` for `organization` → `/admin/organizations/<id>`, `platform_admin` → `/admin/admins/<id>`).
  - **Diff:** se `diff_before` E `diff_after` presentes → tabela 3 colunas (campo, antes, depois) com destaque visual em campos alterados (cor de borda verde para depois / vermelho para antes). Se só `diff_after` (creation event) → JSON pretty-printed em monospace. Se nenhum → linha "Sem diff registrado".
  - **Metadata:** JSON pretty-printed em `<pre>` com sintaxe-highlight básica (chaves negritadas).
  - **Network/contexto:** `ip_address` + `user_agent` (truncado com tooltip).
- **Página `/admin/login` (modificação leve):** input `email` + `password` continuam iguais; **antes** do submit chamar Supabase, a Server Action `signInAdminAction` chama `assertAdminLoginRateLimit({ email, ip })` que pode `throw` com erro tipado `'rate_limit_email'` ou `'rate_limit_ip'`. O componente exibe mensagem genérica não-revelatória "Muitas tentativas. Aguarde alguns minutos." (não diz "5 falhas" nem distingue email vs IP — evita probing).
- **Sidebar:** novo item "Audit log" sob seção "Administração" (junto com "Administradores" do Sprint 11), ícone `History` ou `Scroll` (Lucide).
- **Componentes do design system a reutilizar:** `Button` (variants `primary`/`secondary`/`ghost`), `Input`, `Label`, `Select`, `MultiSelect` (se já existe; senão Combobox composto a partir de `Popover`+`Command` shadcn), `Badge`, `Drawer` ou `Sheet`, `Card`, `Skeleton`, `Toast`, `Pagination`. **APRENDIZADOS 2026-04-21+2026-04-20** alertam sobre repetir botão inline em vez de `<Button variant>` — Guardian valida via grep no GATE 4. **APRENDIZADO 2026-04-15** alerta sobre `min-w-[var(--radix-...)]` quebrar `verify-design`.

---

## 🧬 Reference Module Compliance

**Parcialmente aplicável.**

1. **Padrão de RPC com REVOKE explícito + Server Action wrapper admin:** Sprints 05/09/10/11 são gold standard. Copiar literalmente:
   - Header de RPC: `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`, `REVOKE EXECUTE ON FUNCTION ... FROM public, anon, authenticated`, `GRANT EXECUTE ON FUNCTION ... TO service_role` (APRENDIZADO 2026-04-24 — `REVOKE FROM public` não cobre `anon`).
   - Validação `requirePlatformAdmin()` ou `requirePlatformAdminRole(['owner'])` em mutations; reads usam `requirePlatformAdmin()` retornando o `role` para filtrar projeção quando `billing`.
   - `audit_write(...)` na mesma transação. Se a operação é `record_login_attempt` (alta frequência, sem audit row), **não** chamar `audit_write` — a tabela `login_attempts_admin` é o registro próprio dela.
   - Mapeamento de erro tipado em `actions/*.schemas.ts` → `actions/*.ts` usando o helper de narrowing tipado de `PostgrestError` (APRENDIZADO 2026-04-26 — `error instanceof Error` é falso para `PostgrestError`).

2. **Padrão de listagem com filtros + paginação keyset:** Sprint 05 (`/admin/organizations`) é gold standard em UI. Em SQL, a query do audit é mais agressiva — exige índices compostos. Spec valida estratégia de índice:
   - `(occurred_at DESC, id DESC)` — ordenação default.
   - `(action, occurred_at DESC)` — filtro por action.
   - `(actor_profile_id, occurred_at DESC) WHERE actor_profile_id IS NOT NULL` — filtro por admin.
   - `(target_organization_id, occurred_at DESC) WHERE target_organization_id IS NOT NULL` — filtro por org alvo.
   - **Sem GIN em metadata** no MVP — busca em metadata é fora de escopo.

3. **Padrão de tabela de eventos de alta frequência:** `email_delivery_log` (Sprint 10) é referência exata — `FORCE RLS`, sem trigger de deny UPDATE/DELETE (admin pode purgar antigos via SQL — diferente de `audit_log`), policy SELECT só para platform admins ativos. `login_attempts_admin` segue mesmo padrão. **Não copiar:** `email_delivery_log` permite UPDATE em soft-revoked; `login_attempts_admin` é puramente append (mas sem trigger de deny — o purge da retenção fica para fase 2).

4. **Padrão de script CLI versionado fora do app:** **sem reference module direto** — primeiro script CLI do projeto. Spec define convenções:
   - Localização: `scripts/break-glass.ts` (raiz do projeto, não em `src/`).
   - Runtime: `tsx` (já em devDependencies do Next via `next` toolchain; spec valida — se não, instalar como dev dep).
   - Imports: `dotenv/config` no topo (carrega `.env.local`); `createServiceClient` de `src/lib/supabase/service.ts` reutilizado.
   - Sem `import 'server-only'` (script roda em CLI, não em request).
   - Sem dependências circulares com Next runtime — script lê apenas helpers que não importam de `next/headers` ou `next/navigation`.

5. **Padrão de prompt interativo (confirmação digitada):** RNF-UX-2 já é aplicado em UI (Sprint 05/06/11) — mas em CLI é primeiro do projeto. Spec define: usar `readline` nativo do Node (sem dep nova). Pseudo: `const typed = await question("Digite o email '${email}' para confirmar: "); if (typed !== email) exit(1);`.

**O que copiar:** padrão de RPC com `REVOKE` explícito (Sprints 05+), padrão de listagem keyset com filtros (Sprint 05), padrão de tabela de eventos de alta frequência (`email_delivery_log` Sprint 10), padrão `requirePlatformAdminRole` retornando role para filtragem condicional (Sprint 09 settings).
**O que trocar:** alvo (`audit_log` é leitura; `login_attempts_admin` é tabela nova; break-glass é CLI fora do app), schemas Zod específicos do domínio audit/rate-limit, action slugs novos.
**O que NÃO copiar:** lógica de mutation transacional do Sprint 03 (`audit_log` continua sendo append-only via RPC `audit_write` existente — Sprint 12 NÃO toca writes em audit_log, apenas reads + adiciona coluna reservada); trigger Sprint 02 last-owner (não relevante para audit/rate-limit/break-glass diretamente, embora break-glass o exercite indiretamente ao reativar owner).

---

## 📋 Funcionalidades (Escopo)

### Backend

#### Banco de dados (autor: `@db-admin`)

> **Pré-requisito:** o sprint depende de uma única tabela nova (`login_attempts_admin`) e uma coluna nova reservada (`audit_log.retention_expires_at`). Sem alteração em tabelas críticas; sem novas exceções globais (audit_log já é exceção registrada em PROJECT_CONTEXT.md §2 desde admin_03).

- [ ] **Tabela `login_attempts_admin`** (FORCE RLS):
  - Colunas:
    - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
    - `email text NOT NULL CHECK (length(email) BETWEEN 3 AND 320 AND email = lower(email))` — armazenado lowercased; comparações case-insensitive consistentes (mesma convenção de `platform_admin_invitations` Sprint 11).
    - `email_hash bytea NOT NULL` — `digest(email, 'sha256')` calculado em INSERT-time pela RPC. Usado quando o audit_log referencia o email sem armazenar plaintext (defesa em profundidade contra dump da audit table).
    - `ip_address inet NOT NULL` — IP de origem extraído de `x-forwarded-for` cabeçalho (mesmo helper do Sprint 03 `audit_write`).
    - `user_agent text NULL` — opcional; trunca em 500 chars.
    - `success boolean NOT NULL` — `true` se Supabase Auth retornou sessão; `false` se rejeitou por credencial inválida ou MFA challenge falhou. **Não diferencia o motivo** — campo é binário pra simplificar a janela de rate limit (any failure conta).
    - `occurred_at timestamptz NOT NULL DEFAULT now()`.
    - `metadata jsonb NULL DEFAULT '{}'::jsonb` — extensível (ex.: `{"reason":"invalid_password"}` no futuro).
  - **Índices** (críticos para sliding-window query):
    - `(email, occurred_at DESC)` — leitura "5 falhas em 10min para este email".
    - `(ip_address, occurred_at DESC)` — leitura "20 falhas em 10min para este IP".
    - `(occurred_at DESC)` — purge job futuro (fase 2).
  - **FORCE RLS.** Policies:
    - SELECT: `is_platform_admin(auth.uid())` retorna não-null AND role IN ('owner','support'). **billing não vê** — fora do escopo (rbac_matrix linha 83).
    - **Sem policies de mutação** — writes via RPC `record_admin_login_attempt` `SECURITY DEFINER` chamada apenas pela Server Action `signInAdminAction` (service-role ou JWT-auth — spec valida; recomendação: RPC com `SECURITY DEFINER` chamada por service client porque login acontece **antes** de haver JWT user).

- [ ] **Coluna nova `audit_log.retention_expires_at timestamptz NULL`**:
  - Default `NULL` — significa "reter indefinidamente". Quando D-7 for resolvido em fase 2, um job seta o valor com base na política (ex.: `audit_write` calcula `now() + interval '7 years'` para slugs de compliance + `now() + interval '90 days'` para `inspect.read_*`).
  - **Sem enforcement no MVP** — purge job é fase 2. Coluna existe para evitar migration adicional quando D-7 for implementado.
  - **Sem audit em mutation desta coluna** — coluna é state machine de retenção, não evento de produto.
  - Triggers de deny existentes (`audit_log_deny_mutation`/`audit_log_deny_truncate`) continuam ativos — purge futuro precisará bypass via service_role + função `SECURITY DEFINER` dedicada (fora deste sprint).

- [ ] **Atualizar tabela "Exceções em `public.*`"** em [`docs/PROJECT_CONTEXT.md`](../../docs/PROJECT_CONTEXT.md) §2 (não em `standards.md` — APRENDIZADO 2026-04-19): adicionar linha para `login_attempts_admin` (catálogo de eventos de auth da plataforma; sem `organization_id` por ser evento pré-autenticação) com proteção compensatória (FORCE RLS + writes via RPC SECURITY DEFINER + sem policy de mutação).

- [ ] **RPCs novas** (todas `SECURITY DEFINER`, `SET search_path = public`, REVOKE explícito de `public, anon, authenticated`, GRANT só para `service_role`):

  - `record_admin_login_attempt(p_email text, p_ip inet, p_user_agent text, p_success boolean) RETURNS void` — INSERT em `login_attempts_admin` calculando `email_hash = digest(lower(p_email), 'sha256')`. Sem audit row. Idempotência não-aplicável (eventos são puros append). **Service-role only** (Server Action chama via service client — login acontece antes do JWT user existir).

  - `count_admin_login_failures(p_email text, p_ip inet, p_window interval) RETURNS jsonb` — retorna `{"by_email": int, "by_ip": int}` em uma query única usando `FILTER`:
    ```sql
    SELECT jsonb_build_object(
      'by_email', count(*) FILTER (WHERE email = lower(p_email) AND success = false),
      'by_ip',    count(*) FILTER (WHERE ip_address = p_ip AND success = false)
    )
    FROM login_attempts_admin
    WHERE occurred_at > now() - p_window;
    ```
    **Service-role only.**

  - `audit_login_admin_event(p_email text, p_ip inet, p_user_agent text, p_action text, p_metadata jsonb) RETURNS void` — wrapper SECURITY DEFINER que emite linha em `audit_log` com `action = p_action` (`auth.login_admin_success` | `auth.login_rate_limited` | `auth.login_admin_failed_critical` (reservado)), `actor_profile_id = NULL` quando login falhou (não há profile resolvido), `actor_email_snapshot = p_email`, `target_type='auth_session'`, `target_id=NULL`, `metadata` enriquecido com `email_hash` (em vez de email plaintext em caminhos de rate-limit). **Service-role only.** Reutiliza `audit_write` internamente para preservar invariante INV-6 (transação). Spec valida se vale ter wrapper dedicado vs chamar `audit_write` direto da Server Action — recomendação: wrapper (consolida hashing do email).

  - `break_glass_recover_owner(p_email text, p_operator text, p_origin_host text) RETURNS jsonb` — chamada **apenas** pelo CLI `scripts/break-glass.ts`. Operação atômica em transação:
    1. `SELECT id INTO v_profile_id FROM profiles WHERE lower(email) = lower(p_email);` — se NULL, raise erro tipado `'profile_not_found'`.
    2. `INSERT INTO platform_admins (profile_id, role, is_active, created_by) VALUES (v_profile_id, 'owner', true, v_profile_id) ON CONFLICT (profile_id) WHERE deactivated_at IS NULL DO UPDATE SET role='owner', is_active=true;` — spec valida o índice de unicidade existente em `platform_admins` (Sprint 02 criou `(profile_id) WHERE is_active=true` partial unique?). Se não há partial unique apropriado, fazer SELECT-then-UPDATE/INSERT.
    3. Para cada factor TOTP `verified` em `auth.mfa_factors WHERE user_id = v_profile_id`: chamar `auth.admin.mfa.deleteFactor(factorId)`. **Atenção:** `auth.admin.mfa.deleteFactor` é API JS, não SQL — então a invalidação de TOTP fica na Server Action TS do CLI, **não** dentro do RPC. RPC limita-se a (1) garantir owner ativo + (2) `UPDATE profiles SET mfa_reset_required=true WHERE id=v_profile_id` + (3) audit. Spec valida divisão de responsabilidades.
    4. `audit_write('break_glass.recover_owner', 'profile', v_profile_id, NULL, NULL, jsonb_build_object('email', p_email, 'restored_role', 'owner'), jsonb_build_object('operator', p_operator, 'origin_host', p_origin_host), NULL, 'cli/break-glass.ts')`.
    5. Retorna `{"profile_id": uuid, "platform_admin_id": uuid, "audit_log_id": uuid}` para o CLI exibir.
  - **Service-role only.** REVOKE também de `authenticated` (CLI roda com service client; usuário nunca chama via JWT).

- [ ] **Validar invariantes pós-migration:**
  - `login_attempts_admin` com FORCE RLS ON.
  - 4 RPCs novas com `prosecdef=true` (SECURITY DEFINER), `proconfig` contendo `search_path=public`.
  - Privilégios: `has_function_privilege('anon', '...', 'execute') = false` para todas.
  - `audit_log.retention_expires_at` existe + default NULL.

#### Server Actions (autor: `@backend`)

> **Localização canônica:** `src/lib/actions/admin/audit.ts` (audit UI) + modificações em `src/lib/actions/admin/admin-auth.ts` (rate limit no login). Helpers compartilhados em `src/lib/rateLimit/adminLogin.ts`.

- [ ] **`src/lib/actions/admin/audit.ts`** (read-only — listagem + detalhe do audit):

  - `listAuditLogAction(filters: AuditFilters, cursor?: AuditCursor, pageSize: 50)` — Server Action:
    1. `const ctx = await requirePlatformAdmin()` — retorna `{profileId, role}`.
    2. Validar `filters` com Zod schema (`auditFiltersSchema` — todos opcionais; `period` aceita preset string OR `{from, to}` ISO).
    3. Construir query com filtros aplicados + RBAC:
       - Se `ctx.role === 'billing'`: forçar `WHERE action ~ '^(plan|subscription|grant|org)\\.'` (regex Postgres) — projeção restrita.
       - Se `ctx.role IN ('owner', 'support')`: sem restrição de projeção.
    4. Paginação keyset: `WHERE (occurred_at, id) < (cursor.occurred_at, cursor.id) ORDER BY occurred_at DESC, id DESC LIMIT 50`. Se `cursor` ausente → first page.
    5. Retornar `ActionResponse<{ rows: AuditLogRow[], nextCursor: AuditCursor | null }>`.
    6. **Sem audit** — leitura de audit não gera audit (evita feedback loop de visualizações).
  - `getAuditLogEntryAction(id: string)` — detalhe; mesma validação RBAC; retorna `ActionResponse<AuditLogRow>` ou erro tipado `'audit_entry_not_found'` (cobre tanto não-existe quanto fora-do-escopo-billing).
  - `searchAuditActorsAction(query: string)` — autocomplete de admins para o filtro: `SELECT DISTINCT actor_profile_id, actor_email_snapshot FROM audit_log WHERE actor_email_snapshot ILIKE '%query%' LIMIT 10`. RBAC: qualquer platform admin lê (não-sensível).
  - `getAuditActionRegistryAction()` — retorna lista canônica de slugs conhecidos agrupados por prefixo (ex.: `org.* → ['org.create', 'org.suspend', 'org.reactivate']`). Lista é **estática em código** (`src/lib/audit/actionRegistry.ts`) — não consulta DB. Mesma filosofia do feature flag registry (Sprint 09): se aparece em audit_log mas não no registry, frontend mostra como "(desconhecido)" e Guardian/sanity-checker pega na próxima sprint.

- [ ] **`src/lib/rateLimit/adminLogin.ts`** (helper puro — sem Server Action wrapper, é chamado de dentro de `signInAdminAction`):

  - `import 'server-only'` no topo.
  - Constantes: `WINDOW = '10 minutes'`, `MAX_PER_EMAIL = 5`, `MAX_PER_IP = 20`. Spec valida se constantes ficam em `platform_settings` (override em runtime) ou hardcoded — recomendação: hardcoded no MVP, mover para settings em fase 2 quando virar parametrizável.
  - `assertAdminLoginRateLimit({ email, ip, userAgent }): Promise<void>`:
    1. Chama `count_admin_login_failures(p_email=email, p_ip=ip, p_window='10 minutes')` via `createServiceClient()`.
    2. Se `result.by_email >= 5`: chama `audit_login_admin_event(p_action='auth.login_rate_limited', p_metadata={"scope":"email","attempts":result.by_email,"window_minutes":10})` + `throw RateLimitError('rate_limit_email')`.
    3. Se `result.by_ip >= 20`: análogo com `scope='ip'`.
    4. Se ambos abaixo: retorna void.
  - `recordAdminLoginAttempt({ email, ip, userAgent, success })`: chama `record_admin_login_attempt` via service client. Sem throw — fail-safe (se DB inacessível, login flui mas log pode pular; spec valida trade-off — alternativa: `assertAdminLoginRateLimit` falha-closed e `recordAdminLoginAttempt` falha-open).

- [ ] **Modificação em `src/lib/actions/admin/admin-auth.ts`** (Sprint 04 + Sprint 11):

  - `signInAdminAction(input)`:
    1. Resolver `ip` e `userAgent` de `headers()` (helper compartilhado com `writeAudit`).
    2. **Antes** de `supabase.auth.signInWithPassword`: `await assertAdminLoginRateLimit({ email, ip, userAgent })`. Se throw com `'rate_limit_email'` ou `'rate_limit_ip'`: retornar `{ success: false, error: 'Muitas tentativas. Aguarde alguns minutos.' }` (mensagem genérica não-revelatória).
    3. Chamar `supabase.auth.signInWithPassword({ email, password })`.
    4. Se erro: `await recordAdminLoginAttempt({ email, ip, userAgent, success: false })` + retornar erro genérico.
    5. Se sucesso (sessão estabelecida): `await recordAdminLoginAttempt({ email, ip, userAgent, success: true })` + chamar `audit_login_admin_event(p_action='auth.login_admin_success', p_metadata={...})` (RF-AUDIT-1) + retornar `{ success: true, ... }`.
  - **Atenção**: o Sprint 04 implementou `signInAdminAction` chamando `requireAdminSession` no callback de pós-login? Spec confirma que rate limit + login attempt são ortogonais ao MFA challenge (que é etapa subsequente).

- [ ] **Action registry canônico** em `src/lib/audit/actionRegistry.ts`:
  ```typescript
  export const AUDIT_ACTION_REGISTRY = {
    'org.*': ['org.create', 'org.suspend', 'org.reactivate'],
    'subscription.*': ['subscription.change_plan', 'subscription.extend_trial', 'subscription.cancel', 'subscription.reactivate', 'subscription.auto_expire'],
    'plan.*': ['plan.create', 'plan.update', 'plan.archive', 'plan.delete'],
    'grant.*': ['grant.create', 'grant.revoke'],
    'inspect.*': ['inspect.read_leads', 'inspect.read_users', /* ... */],
    'platform_admin.*': ['platform_admin.invite_create', /* 8 mais — Sprint 11 */],
    'password_reset.*': ['password_reset.complete_admin', 'password_reset.mfa_reenroll_complete'],
    'auth.*': ['auth.login_admin_success', 'auth.login_rate_limited'],
    'settings.*': ['settings.update'],
    'feature_flag.*': ['feature_flag.set'],
    'legal_policy.*': ['legal_policy.create'],
    'integration_credential.*': ['integration_credential.create', 'integration_credential.rotate', 'integration_credential.revoke'],
    'email.*': ['email.offline_fallback'],
    'metrics.*': ['metrics.refresh'],
    'break_glass.*': ['break_glass.recover_owner'],
  } as const;
  ```
  Spec valida lista exaustiva contra `git log --all --oneline | grep -i audit` para descobrir slugs históricos não-listados.

#### Script CLI (autor: `@backend` — script TS, não Server Action)

- [ ] **`scripts/break-glass.ts`** — entry point CLI:

  ```typescript
  // Pseudo-código — spec valida estrutura
  import 'dotenv/config';
  import { createServiceClient } from '../src/lib/supabase/service';
  import { createInterface } from 'node:readline/promises';
  import { stdin, stdout } from 'node:process';

  async function main() {
    // 1. Validar env vars (fail-closed antes de qualquer write)
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const breakGlassSecret = process.env.BREAK_GLASS_SECRET;
    const operator = process.env.BREAK_GLASS_OPERATOR;
    if (!serviceKey) exit('SUPABASE_SERVICE_ROLE_KEY missing');
    if (!breakGlassSecret) exit('BREAK_GLASS_SECRET missing');
    if (!operator) exit('BREAK_GLASS_OPERATOR missing (set to your name/email/handle)');
    // Spec valida: BREAK_GLASS_SECRET é comparado contra valor esperado armazenado em platform_settings.break_glass_secret_hash (SHA-256), ou apenas presença? Recomendação: comparação. Implementação:
    //   const expectedHash = await fetchPlatformSetting('break_glass_secret_hash');
    //   if (sha256(breakGlassSecret) !== expectedHash) exit('BREAK_GLASS_SECRET invalid');
    // Spec valida onde armazenar o hash (platform_settings com proteção SELECT só para service_role) e qual o fluxo de rotação.

    // 2. Argumento email do alvo
    const email = process.argv[2]?.toLowerCase().trim();
    if (!email || !email.match(/^[^@]+@[^@]+\.[^@]+$/)) exit('Usage: tsx scripts/break-glass.ts <email>');

    // 3. Confirmação digitada (RNF-UX-2)
    const rl = createInterface({ input: stdin, output: stdout });
    console.log(`\n⚠ BREAK-GLASS: vai restaurar OWNER + invalidar MFA do profile com email '${email}'.`);
    console.log(`Operator: ${operator}\n`);
    const typed = await rl.question(`Digite o email '${email}' para confirmar: `);
    if (typed !== email) exit('Email confirmation mismatch — abort.');
    rl.close();

    // 4. Executar via service client
    const sb = createServiceClient();

    // 4a. RPC garante owner ativo + seta mfa_reset_required + audit
    const { data, error } = await sb.rpc('break_glass_recover_owner', {
      p_email: email,
      p_operator: operator,
      p_origin_host: process.env.HOSTNAME ?? 'unknown',
    });
    if (error) exit(`RPC error: ${error.message}`);

    // 4b. Invalidar TOTP factors via Auth Admin API
    const { data: { users } } = await sb.auth.admin.listUsers();
    const target = users.find(u => u.email?.toLowerCase() === email);
    if (!target) exit(`Auth user not found for ${email} (RPC succeeded but auth user missing — out-of-sync state)`);

    const { data: factorsResp } = await sb.auth.admin.mfa.listFactors({ userId: target.id });
    const factors = factorsResp?.factors ?? [];
    for (const f of factors) {
      if (f.factor_type === 'totp') {
        await sb.auth.admin.mfa.deleteFactor({ userId: target.id, id: f.id });
      }
    }

    console.log(`\n✓ Owner restored. profile_id=${data.profile_id}`);
    console.log(`✓ MFA factors invalidated: ${factors.filter(f => f.factor_type === 'totp').length}`);
    console.log(`✓ Audit log id: ${data.audit_log_id}`);
    console.log(`\nTarget must complete MFA re-enroll on next /admin/login (Sprint 11 mfa_reset_required flag).`);
  }

  main().catch(err => exit(err.message ?? String(err)));
  function exit(msg: string): never { console.error(`✗ ${msg}`); process.exit(1); }
  ```
  Spec valida: ordem (RPC → Auth API), tratamento de erro parcial (RPC sucesso + Auth API falha = estado inconsistente), idempotência (rerun é seguro).

- [ ] **Hash do `BREAK_GLASS_SECRET`** armazenado em platform_settings:
  - Spec valida: criar setting `break_glass_secret_hash` (key novo) ou tabela dedicada? Recomendação: setting key novo (`platform_settings` Sprint 09 já é o lugar canônico).
  - Seed inicial: rodar SQL manual via Studio: `select admin_set_setting('break_glass_secret_hash', encode(digest('<chosen-secret>', 'sha256'), 'hex'), 'text', auth.uid());` — rotação manual via mesmo SQL. Runbook documenta.

#### Integration tests (autor: `@qa-integration`)

- [ ] **`tests/integration/admin-audit.test.ts`** — cobertura:
  - Happy path: `listAuditLogAction` com filtros vazios retorna primeira página.
  - Filtro por `action='org.suspend'`: query SQL recebe `WHERE action='org.suspend'` (mock client validates call args).
  - Filtro por período custom: from/to enviado para SQL.
  - Paginação keyset: segunda página recebe `(occurred_at, id) < cursor`.
  - RBAC owner: vê todas as ações.
  - RBAC support: vê todas as ações.
  - RBAC billing: query SQL **deve** conter o regex `^(plan|subscription|grant|org)\\.` no WHERE — assertion sobre args do mock.
  - Auth ausente: retorna `success: false` sem chamar Supabase (regra do contrato de Server Action).
  - Validação Zod de filtros: `period.from` inválido → erro sem chamar Supabase.
  - `getAuditLogEntryAction` com id não-existente → `'audit_entry_not_found'`.
  - `searchAuditActorsAction` com query <2 chars → erro de validação.

- [ ] **`tests/integration/admin-rate-limit.test.ts`** — cobertura:
  - 5 falhas em 10min para mesmo email → 6ª chamada a `signInAdminAction` retorna erro genérico + `audit_login_admin_event('auth.login_rate_limited', scope='email')` chamado.
  - 4 falhas em 10min → 5ª passa pelo rate limit (não bloqueia ainda) + chama Supabase (mock retorna sucesso) + `record_admin_login_attempt(success=true)` é chamado.
  - 20 falhas em 10min do mesmo IP contra emails diversos → 21ª retorna 429 + audit `scope='ip'`.
  - Login bem-sucedido grava `audit_login_admin_event('auth.login_admin_success')`.
  - Falha de rede em `count_admin_login_failures` (RPC retorna erro) → `assertAdminLoginRateLimit` falha-closed (deny login com erro genérico).
  - Falha de `record_admin_login_attempt` após login bem-sucedido → login flui (fail-open) + warn em log de aplicação.
  - Email com casing variado (`FOO@axon.io` vs `foo@axon.io`) → tratado como mesmo email (lowercase normalization).

- [ ] **`tests/integration/break-glass-rpc.test.ts`** — cobertura da RPC apenas (CLI propriamente dito é exercitado por teste manual em runbook — script CLI não tem mock de Auth Admin API trivial):
  - Happy path: `break_glass_recover_owner('edsonmmiranda@gmail.com', 'edson-laptop', 'host123')` cria/atualiza linha em `platform_admins` + seta `profiles.mfa_reset_required=true` + grava audit `break_glass.recover_owner`.
  - Email não-existente → `'profile_not_found'`.
  - Profile já existe como owner ativo → idempotente (não duplica linha em platform_admins).
  - Profile existe como `support` → upgrade para `owner` + audit registra mudança.
  - Profile desativado → reativa (`is_active=true`).
  - Audit row contém `metadata.operator` e `metadata.origin_host` (assertion direta no payload).
  - Caller via `anon` → `permission denied` (REVOKE explícito).
  - Caller via `authenticated` JWT regular → `permission denied`.
  - Caller via `service_role` → sucesso.

> **Sem `it.skip` em nenhum dos 3 arquivos** — gate 4.5 bloqueia. Volume estimado: 25 + 12 + 12 = ~49 testes.

### Frontend (autor: `@frontend+`)

- [ ] **Rotas novas:**
  - `src/app/admin/audit/page.tsx` — listagem com filtros + tabela paginada + drawer.
  - `src/app/admin/audit/[id]/page.tsx` — variante com URL bookmarcable (drawer aberto direto). Spec valida: pode ser uma única route com searchParam `?id=...` ou rota dedicada — recomendação: rota dedicada (mais SEO-friendly e bookmarcable).

- [ ] **Componentes novos** em `src/components/admin/audit/`:
  - `AuditFilters.tsx` — bloco de filtros com `action` (MultiSelect agrupado), `actor` (Combobox com fetch via `searchAuditActorsAction`), `target_organization` (Combobox), `period` (preset+custom), `target_type` (Select). Estado em URL via `searchParams` (compatível com bookmark + back/forward).
  - `AuditTable.tsx` — tabela com 6 colunas + linhas clicáveis. Empty state + skeleton + pagination com cursor (botão "Carregar mais" no fim).
  - `AuditDetailDrawer.tsx` (ou `AuditDetailPage.tsx` se for rota separada) — header + diff + metadata + network. Diff renderizado com `<DiffTable>` quando `diff_before` E `diff_after`; com `<JsonView>` quando creation event.
  - `AuditActionBadge.tsx` — `<Badge>` com variant resolvida do prefixo (`*.create`/`*.update`/`*.delete`/`auth.login_rate_limited`/`break_glass.*`/etc.). Mapeamento estático em `src/lib/audit/actionPalette.ts`.
  - `JsonView.tsx` (ou reutilizar componente existente em design system) — renderiza JSON com chaves negritadas, valores em monospace, nesting indentado. Sem dep externa pesada — implementação simples ~50 linhas TSX.
  - `DiffTable.tsx` — 3 colunas (campo, antes, depois); destaque visual em campos alterados via comparação literal das chaves de top-level.

- [ ] **Modificação leve em `src/components/admin/AdminLoginForm.tsx`** (Sprint 04):
  - Tratar erro `'rate_limit_email'`/`'rate_limit_ip'` retornado por `signInAdminAction` exibindo mensagem genérica não-revelatória ("Muitas tentativas. Aguarde alguns minutos.").
  - **Não** mostrar contador, **não** distinguir scopes, **não** sugerir delay específico — minimização de informação para atacante (RNF-OBS-2).

- [ ] **Sidebar** (`src/components/admin/AdminSidebar.tsx`):
  - Adicionar item "Audit log" sob seção "Administração" (junto com "Administradores" do Sprint 11). Ícone `History` ou `Scroll` (Lucide).
  - Visível para todos os papéis (owner/support/billing) — RBAC é aplicado server-side na Server Action.

- [ ] **Estados a cobrir:**
  - Lista vazia (filtros restritivos) → ilustração + CTA "Limpar filtros".
  - Skeleton durante load → 6 linhas placeholder.
  - Erro de fetch → toast danger + linha "Falha ao carregar — tente novamente" + botão de retry.
  - Loading "Carregar mais" → spinner inline + botão disabled.
  - Detalhe de linha sem `diff_*` → "Sem diff registrado" em vez de tabela vazia.
  - Detalhe de linha com `target_type` resolvível → link clicável; com tipo desconhecido (slug não no registry) → texto + tooltip "Tipo não registrado em actionRegistry.ts — abrir issue".

- [ ] **Performance / RNF-PERF-2:**
  - Filtros nunca disparam SELECT COUNT(*) total — paginação keyset evita. Banner "100k+ linhas" quando primeira página retornar 50 e cursor não-null (informação aproximada).
  - Drawer de detalhe usa `getAuditLogEntryAction` (uma query indexada em PK).

---

## 🧪 Edge Cases (obrigatório listar)

- [ ] **Audit listagem vazia (org sem ações):** UI mostra empty state + CTA "Limpar filtros". Não exibe spinner indefinido.
- [ ] **Audit com `actor_profile_id=NULL`** (login falhou antes de identificar profile, ou ação anônima): coluna "Quem" mostra `actor_email_snapshot` ou "—" se ambos null.
- [ ] **Audit com `target_id=NULL`** (slugs como `metrics.refresh`, `settings.update`, `feature_flag.set`): coluna "Alvo" mostra `target_type` + valor de `metadata.key` quando aplicável.
- [ ] **Audit com `diff_before=null AND diff_after=null`** (eventos como `auth.login_admin_success`, `inspect.read_leads`): drawer mostra "Sem diff registrado" + metadata completa.
- [ ] **Audit com `metadata` muito grande** (>50KB): truncar visualmente com botão "Ver completo" (lazy-load via `getAuditLogEntryAction`); export em JSON via copy-button.
- [ ] **Filtro retorna 0 linhas + cursor null:** empty state correto; sem loading infinito.
- [ ] **Paginação no fim do dataset:** botão "Carregar mais" desabilita; nenhuma chamada extra.
- [ ] **billing tenta abrir audit row de slug `platform_admin.role_change` por ID direto via URL:** Server Action `getAuditLogEntryAction` retorna `'audit_entry_not_found'` (mensagem genérica que cobre tanto "não existe" quanto "fora do escopo"). RBAC defesa em profundidade.
- [ ] **billing mexe na URL para forçar filtro `action=platform_admin.invite_create`:** query SQL aplica BOTH o filtro requested AND o regex de RBAC (`^(plan|subscription|grant|org)\\.`); intersecção é vazia; UI mostra empty state.
- [ ] **Rate limit: 4 falhas dentro de 10min + 1 sucesso → contador zera ou continua?** Recomendação: contador apenas falhas (success não conta). Spec valida — atacante alterna emails para evadir reset.
- [ ] **Rate limit: clock skew entre app e DB:** janela usa `now()` do banco (consistente). App não calcula janela.
- [ ] **Rate limit: usuário legítimo em 5 falhas seguidas (esqueceu senha):** UX mostra mensagem genérica; usuário recorre a "Esqueci minha senha" (Sprint 11) — flow de password reset não está atrás do rate limit (só `signInAdminAction` está).
- [ ] **Rate limit: IP atrás de NAT corporativo (vários admins atrás do mesmo IP):** limite de 20 por IP cobre uso normal de equipe pequena (<10 admins). Ataque que excede 20 em 10min seria genuíno alvo de bloqueio. Spec valida limites.
- [ ] **Rate limit: header `x-forwarded-for` ausente ou spoofed:** helper extrai com fallback para IP do peer; spec confirma comportamento atrás de Vercel (cabeçalho confiável).
- [ ] **Break-glass com email correto digitado em casing diferente** ("FOO@axon.io" vs "foo@axon.io" no prompt): RPC normaliza para lowercase; CLI compara após `.toLowerCase().trim()`. Spec valida.
- [ ] **Break-glass com profile que tem MFA enrolled de outro tipo (não TOTP, ex.: phone — MVP não suporta mas Supabase aceita):** CLI ignora factors não-TOTP e prossegue. Recomendação: spec valida — alternativa: deletar todos os factors. Por garantia: deletar **todos** os factors `verified` e `unverified` para garantir re-enroll limpo.
- [ ] **Break-glass duas vezes consecutivas (idempotência):** segunda execução é no-op em `platform_admins` (UPSERT idempotente) + no-op em `mfa_factors` (já zero) + grava 2ª linha de audit (event log). Esperado: cada execução é evento separado mesmo que o efeito seja idempotente.
- [ ] **Break-glass com `BREAK_GLASS_SECRET` correto mas hash não setado em platform_settings (boot inicial):** CLI falha com `'BREAK_GLASS_SECRET hash not configured — run setup SQL first'`. Runbook documenta o setup SQL antes do primeiro uso.
- [ ] **Break-glass + admin alvo já está logado em outra sessão:** sessão antiga continua até expirar, mas `mfa_reset_required=true` força re-enroll no próximo `requireAdminSession()` (Sprint 11). Spec valida que sessões existentes não são revogadas (Supabase não tem API trivial para isso) — atacante com sessão antiga ainda tem janela; mitigação: reduzir TTL admin para 8h (Sprint 04 D-8 já cobre).

---

## 🚫 Fora de escopo

- **Política de retenção de audit_log implementada** — apenas a coluna `retention_expires_at` é criada (reservada). D-7 fica como decisão a documentar em `docs/PROJECT_CONTEXT.md` §3 (default sugerido pelo spec: 7 anos para slugs de compliance, 90 dias para `inspect.read_*`, 1 ano para `auth.*`). Purge job é fase 2.
- **Export CSV/JSON do audit_log** — UI mostra apenas listagem + drawer. Export é fase 2 (formato + permissão por papel exigem decisão).
- **Dashboard agregado de tentativas de login falhadas** (gráfico, top IPs, mapa de calor) — fora do MVP. Diagnóstico via SQL direto na tabela `login_attempts_admin`.
- **Rate limit no customer app** — Sprint 12 cobre apenas `/admin/login`. Customer login (`/login`) tem o rate limit padrão do Supabase Auth (configurável no dashboard) — sem mudanças neste sprint.
- **Bloqueio de IP via firewall/WAF** — rate limit é em nível de aplicação. WAF é responsabilidade de deploy (Sprint 13).
- **CAPTCHA** após N falhas — fora do MVP. Mensagem genérica + delay implícito (rate limit de 10min) são suficientes para atacante humano.
- **Notificação por email/Slack quando rate limit é triggered** — fora do MVP. Detecção via `RNF-OBS-2` é por consulta direta ao audit log.
- **Notificação automática em break-glass** (alerta Slack/email/SMS) — runbook recomenda que operador notifique stakeholders manualmente no canal de incidente. Alerta automático é fase 2 (exige integração externa).
- **MFA de break-glass** — operador com as duas credenciais executa diretamente. MVP confia em separação de cofres (T-20 mitigação).
- **Revogação de sessões existentes ao executar break-glass** — Supabase Auth não tem API trivial; sessão antiga continua até TTL admin (8h) e é interceptada por `mfa_reset_required=true` no próximo refresh do middleware. Spec valida — alternativa: deletar refresh tokens da `auth.refresh_tokens` (suporte oficial questionável).
- **Audit log para customer app** — visibilidade do audit é exclusivamente admin. Customer não vê audit das suas próprias ações neste sprint.
- **Auditoria automática do CLI** (cron que vigia `break_glass.recover_owner` e abre ticket) — fora do MVP.

---

## ⚠️ Critérios de Aceite

- [ ] 1 tabela nova (`login_attempts_admin`) criada com `FORCE RLS`. Validar:
  ```sql
  SELECT relname, relforcerowsecurity FROM pg_class WHERE relname = 'login_attempts_admin';
  -- esperado: t
  ```
- [ ] Coluna `audit_log.retention_expires_at timestamptz NULL` criada com default NULL.
- [ ] **G-13 (rate limit)**: 6 chamadas a `signInAdminAction` com mesmo email + senha errada em <10min → 6ª retorna erro genérico + linha em `audit_log` com `action='auth.login_rate_limited'` + `metadata.scope='email'`. Validado por integration test.
- [ ] **G-13 (escopo IP)**: 21 chamadas a `signInAdminAction` do mesmo IP com emails distintos em <10min → 21ª retorna 429 + audit com `scope='ip'`.
- [ ] **G-21 (break-glass double-key)**: rodar `tsx scripts/break-glass.ts edsonmmiranda@gmail.com` sem `BREAK_GLASS_SECRET` no env → CLI falha **antes** de qualquer write no banco (validar via `SELECT count(*) FROM audit_log WHERE action='break_glass.recover_owner'` antes/depois — mesmo número).
- [ ] **G-21 (break-glass execução válida)**: env válida + confirmação correta → `platform_admins` row com `role='owner', is_active=true` para o profile + `profiles.mfa_reset_required=true` + 1 linha em `audit_log` com `action='break_glass.recover_owner'` + `metadata.operator` correto. Validado por integration test em `break_glass_recover_owner` RPC + smoke test manual de CLI documentado em runbook.
- [ ] **G-10 revalidado** (audit append-only): tentativa de `UPDATE audit_log SET action='tampered'` via service_role retorna erro do trigger `audit_log_deny_mutation`. Já coberto pelo Sprint 03 — Sprint 12 não regride; spec valida via teste de regressão.
- [ ] **RBAC do audit UI**:
  - owner abre `/admin/audit` → vê linhas de TODAS as actions.
  - support abre → vê linhas de TODAS as actions.
  - billing abre → vê APENAS linhas onde `action ~ '^(plan|subscription|grant|org)\\.'`. Validado por integration test que mocka session com role `billing` e assertion sobre query SQL.
  - Tentativa de billing com URL `?action=platform_admin.invite_create` → empty state (regex regex-and-restriction intersect = ∅).
- [ ] **RPCs criadas com privilégios corretos**:
  ```sql
  SELECT has_function_privilege('anon', 'public.record_admin_login_attempt(text,inet,text,boolean)', 'execute');                  -- false
  SELECT has_function_privilege('service_role', 'public.record_admin_login_attempt(text,inet,text,boolean)', 'execute');           -- true
  SELECT has_function_privilege('anon', 'public.count_admin_login_failures(text,inet,interval)', 'execute');                       -- false
  SELECT has_function_privilege('service_role', 'public.count_admin_login_failures(text,inet,interval)', 'execute');               -- true
  SELECT has_function_privilege('anon', 'public.audit_login_admin_event(text,inet,text,text,jsonb)', 'execute');                   -- false
  SELECT has_function_privilege('service_role', 'public.audit_login_admin_event(text,inet,text,text,jsonb)', 'execute');           -- true
  SELECT has_function_privilege('anon', 'public.break_glass_recover_owner(text,text,text)', 'execute');                            -- false
  SELECT has_function_privilege('authenticated', 'public.break_glass_recover_owner(text,text,text)', 'execute');                   -- false
  SELECT has_function_privilege('service_role', 'public.break_glass_recover_owner(text,text,text)', 'execute');                    -- true
  ```
- [ ] Toda mutation grava em `audit_log` com action slug correto, `target_type` correto, `metadata` sem dados sensíveis (sem senhas, sem `BREAK_GLASS_SECRET`, sem token plain — apenas `email`/`scope`/`operator`/`origin_host`/`email_hash`/`attempts`). Validar via SQL pós-teste:
  ```sql
  SELECT action, target_type, metadata FROM audit_log
   WHERE action IN ('auth.login_admin_success', 'auth.login_rate_limited', 'break_glass.recover_owner')
   ORDER BY occurred_at DESC LIMIT 20;
  ```
- [ ] UI `/admin/audit` renderiza nos 4 estados (lista vazia, com linhas, com erro, paginado). Filtros se mantêm em URL searchParams (recarregar preserva).
- [ ] Drawer de detalhe renderiza diff em 3 estados (with diff, creation event sem diff_before, sem diff algum) sem quebrar layout.
- [ ] Login `/admin/login` mostra mensagem genérica "Muitas tentativas..." quando rate limit triggera; **não** mostra contagem, scope, nem distingue email vs IP.
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] **GATE 4.5**: 3 arquivos de teste integrado (`admin-audit.test.ts`, `admin-rate-limit.test.ts`, `break-glass-rpc.test.ts`) passam com 0 falhas, 0 skips. Volume estimado: ~49 testes.
- [ ] **Guardian aprova o código** (GATE 4) — incluindo:
  1. CLI `scripts/break-glass.ts` **não** importa de `next/headers`, `next/navigation` ou qualquer arquivo sob `src/app/` (validado por grep no GATE 4 — spec produz lista de imports proibidos).
  2. Server Actions de audit **não** chamam `audit_write` (leitura não gera audit).
  3. `audit_login_admin_event` **nunca** recebe `password` em metadata (grep guard).
  4. Mensagem de rate limit no frontend é literal "Muitas tentativas. Aguarde alguns minutos." sem variantes que vazem informação.
  5. Triggers `audit_log_deny_mutation` e `audit_log_deny_truncate` ainda ativos após migration (spec exige SELECT pós-migration que confirma).
  6. `<button>` inline para variantes existentes (`primary`, `secondary`, `danger`, `ghost`) é proibido — usar `<Button variant>` (APRENDIZADOS 2026-04-21 + 2026-04-20).
  7. CLI imprime `BREAK_GLASS_SECRET` em error log? Grep guard: o secret nunca aparece em `console.log/error/warn`.
- [ ] **GATE 5 estático**: `node scripts/verify-design.mjs --changed` retorna 0 violações.
- [ ] **Documentação atualizada**:
  - `docs/PROJECT_CONTEXT.md` §2 atualizado com `login_attempts_admin` (catálogo de auth events da plataforma).
  - `docs/PROJECT_CONTEXT.md` §3 D-7 atualizado: "**Decidido (2026-04-XX):** retenção indefinida no MVP; coluna `audit_log.retention_expires_at` reservada; purge job é fase 2 com defaults sugeridos {compliance: 7y, inspect: 90d, auth: 1y}."
  - `docs/PROJECT_CONTEXT.md` §5 ganha bloco §5f documentando: 1 tabela + 1 coluna + 4 RPCs novas + decisão de hash de `BREAK_GLASS_SECRET` em platform_settings + 3 action slugs novos no audit (`auth.login_admin_success`, `auth.login_rate_limited`, `break_glass.recover_owner`).
  - `docs/admin_area/runbook_break_glass.md` **criado**: pré-requisitos (env vars, cofres separados, hash setup SQL), passos de execução, validação pós-execução, rotação de `BREAK_GLASS_SECRET` (cadência sugerida: trimestral, distinta da service role).
  - `docs/admin_area/rbac_matrix.md` linha "Sprint 12" já preenchida desde sprint 02 — confirmar que match com implementação (`audit_log` R para 3 papéis com filtragem para billing; `login_attempts_admin` R para owner+support; CLI break-glass `n/a (fora do modelo de papel — double-key)`).
  - `src/lib/audit/actionRegistry.ts` criado e completo (mapeamento exaustivo dos slugs até Sprint 12).

---

## 🤖 Recomendação de Execução

**Análise:**
- Nível: STANDARD
- Complexity Score: **22** (cap em 22; ≥9 já força Opção 2)
  - DB: **+5** (1 nova tabela `login_attempts_admin` +3 com 3 índices + `email_hash` derived; 1 coluna nova reservada em `audit_log` +1; modificação **não** em `audit_log` writes — apenas reads + add column +1)
  - API/Actions: **+9** (4 RPCs novas — `record_admin_login_attempt`, `count_admin_login_failures`, `audit_login_admin_event`, `break_glass_recover_owner`; ~5 Server Actions read-only para audit UI; modificação de `signInAdminAction` Sprint 04 + Sprint 11 — alto risco de regressão na auth de toda área admin; 1 helper novo `assertAdminLoginRateLimit`; 1 script CLI fora do app com integração com Auth Admin API — primeiro do projeto)
  - UI: **+5** (2 rotas novas + ~6 componentes novos — `AuditFilters`, `AuditTable`, `AuditDetailDrawer`/`Page`, `AuditActionBadge`, `JsonView`, `DiffTable` — primeiros componentes de audit UI do projeto, sem reference module direto para diff renderer; modificação leve de `AdminLoginForm` Sprint 04 + AdminSidebar)
  - Lógica: **+5** (sliding-window rate limit com 2 escopos email+IP — nova; double-key validation com hash em platform_settings — nova; CLI flow com confirmação digitada + idempotência + fallback de erro parcial entre RPC e Auth Admin API — nova; filtragem RBAC condicional por regex no SQL — nova; action registry estático sincronizado com slugs históricos — nova)
  - Dependências: **+4** (interna: Sprints 03/04/09/10/11 — risco médio de regressão em `signInAdminAction` Sprint 04+11 e em `requireAdminSession` Sprint 04+11; externa: Supabase Auth Admin API — `auth.admin.mfa.{listFactors,deleteFactor}` é primeiro uso no projeto)
  - **Total bruto: ~28** (cap em 22 — qualquer ≥9 já força Opção 2)
- Reference Module: **parcial** — Sprints 05/09/10/11 são gold standard para padrão de RPC + Server Action + UI list; Sprint 10 é referência exata para tabela de eventos de alta frequência (`email_delivery_log`); Sprint 04 é referência para login flow; Sprint 11 é referência para `requirePlatformAdminRole` retornando role. **Sem reference module direto** para: (a) script CLI fora do app, (b) renderer de diff JSON pretty-printed, (c) sliding-window rate limit, (d) double-key validation com hash em settings, (e) integração com Auth Admin API (`auth.admin.mfa.*`).
- Integração com API externa: **sim, leve** — Supabase Auth Admin API (`auth.admin.listUsers`, `auth.admin.mfa.listFactors`, `auth.admin.mfa.deleteFactor`) primeira utilização no projeto. Item 2 da árvore (Integração com API externa → Opção 2 forçada) também dispara.
- Lógica de negócio nova/ambígua: **sim, alta** — pontos críticos para o `@spec-writer` resolver:
  - **(a) Atomicidade da contagem de rate limit:** `count_admin_login_failures` retorna snapshot, mas entre o count e o `signInWithPassword` há janela de race (10ms?). 5 sessões paralelas com 4 falhas cada poderiam passar do limite. Spec valida tolerância e se vale `SELECT FOR UPDATE` no histórico (caro) ou aceitar tolerância (recomendação).
  - **(b) Failure mode no `record_admin_login_attempt`:** fail-open vs fail-closed. Recomendação: `assertAdminLoginRateLimit` falha-closed (DB indisponível = bloqueio); `recordAdminLoginAttempt` falha-open (DB indisponível = login flui mas log perdido). Spec valida ortogonalidade — alternativa: ambos fail-closed (login depende totalmente de DB).
  - **(c) Hash de `BREAK_GLASS_SECRET`:** armazenar onde? Recomendação: setting key novo `break_glass_secret_hash` em `platform_settings`. Alternativa: env var `BREAK_GLASS_SECRET_HASH_EXPECTED` (mais simples, sem DB call). Spec decide — recomendação: setting (rotacionável sem deploy).
  - **(d) Atomicidade do break-glass:** RPC vs Auth Admin API são duas calls separadas. Se RPC sucede e Auth API falha → estado inconsistente (owner restaurado mas MFA não invalidado). Spec define: ordem (RPC → Auth API), retry policy, ou compensação. Recomendação: idempotência (rerun é seguro porque RPC é UPSERT e Auth API é DELETE). Documentar trade-off no runbook.
  - **(e) Sessões existentes em break-glass:** atacante com sessão admin antiga (TTL 8h) ainda opera apesar de `mfa_reset_required=true`? Sprint 11 middleware bloqueia no próximo refresh — spec confirma que refresh acontece pelo menos uma vez por hora (Supabase default).
  - **(f) Filtragem RBAC para billing:** regex `^(plan|subscription|grant|org)\\.` — spec valida lista exata de prefixos contra rbac_matrix.md (linha 82: "R (escopo billing apenas)"). Action registry é fonte de verdade.
  - **(g) Renderer de diff:** componente custom vs lib externa (`react-diff-viewer-continued`?). Recomendação: custom simples (sem dep nova; diff é shallow JSON, não texto rico).
  - **(h) Performance da query `count_admin_login_failures`:** índice composto cobre? Spec valida `EXPLAIN ANALYZE` pós-seed com 100k linhas.
  - **(i) Timezone no filtro de período:** UI envia ISO string com TZ; SQL compara em UTC. Banner explicando "horário em UTC" ou converter no display? Recomendação: display em TZ local + tooltip absoluto UTC.
  - **(j) Cardinalidade do filtro `actor`:** autocomplete via `searchAuditActorsAction` retorna até 10 resultados — paginação se >10? Spec valida — recomendação: 10 é suficiente para equipe Axon (<10 admins no MVP, A-2).
- Ambiguity Risk: **alto** — primeiro sprint do projeto com (a) script CLI versionado fora do app, (b) renderer de diff pretty-print, (c) sliding-window rate limit, (d) double-key validation, (e) Auth Admin API. Drift em qualquer um vira retrabalho ou — pior — bypass de rate limit / break-glass silencioso.

---

### Opção 1 — SIMPLES (sem PRD)
- **Fluxo:** Tech Lead → `@db-admin` → `@backend` → `@qa-integration` → `@frontend+` → `@guardian` → gates → commit
- **PRD:** pulado; sprint file é o contrato
- **Modelo sugerido:** N/A — score ≥9 + integração com API externa (Supabase Auth Admin API) + lógica de negócio nova/ambígua (10 pontos) **forçam Opção 2** pela rubrica (3 caminhos independentes).
- **Quando faz sentido:** **não faz sentido aqui.** Risco G-21 (bypass de break-glass double-key = elevação para owner sem rastro) é P0 de segurança. Risco G-13 (rate limit de login admin não enforcado = brute force viável) é P1 de segurança. Executar em Sonnet sem cold review é loteria.

### Opção 2 — COMPLETA (com PRD)
- **Fluxo:** Tech Lead → `@spec-writer` (Implementation Plan) → `@sanity-checker` (loop ≤3×) → STOP & WAIT → `@db-admin` → `@backend` → `@qa-integration` → `@frontend+` → `@guardian` → gates → commit
- **PRD:** gerado em `prds/prd_admin_12_audit_ui_rate_limit_break_glass.md`
- **Modelo sugerido:** **Opus** — cold review do `@spec-writer` + sanity-checker pagam o custo; em Sonnet drifta com 4 RPCs + script CLI + Auth Admin API + 10 decisões de design + risco G-21/G-13.
- **Quando faz sentido:** **aqui.** A rubrica força Opção 2 por **três caminhos independentes**: (1) score ≥9 (item 1 da árvore — score 22 cap), (2) integração com API externa (item 2 — Supabase Auth Admin API), (3) lógica de negócio nova/ambígua em 10 pontos críticos (item 3). O `@spec-writer` precisa fixar antes do `@db-admin` começar:
  1. **Schema canônico** de `login_attempts_admin` com índices exatos + privilege model das 4 RPCs.
  2. **Atomicidade do rate limit** — `SELECT` count com tolerância ou `FOR UPDATE` (recomendação: tolerância, documentar).
  3. **Failure mode** de `record_admin_login_attempt` (fail-open) vs `assertAdminLoginRateLimit` (fail-closed).
  4. **Localização do hash** de `BREAK_GLASS_SECRET` (recomendação: `platform_settings`, key `break_glass_secret_hash`) e fluxo de rotação documentado.
  5. **Ordem da operação break-glass** (RPC → Auth Admin API; idempotência ambos os lados; tratamento de erro parcial documentado em runbook).
  6. **Filtragem RBAC para billing** — lista exata de prefixos validada contra `rbac_matrix.md` linha 82; regex SQL canônica.
  7. **Renderer de diff** — custom componente sem dep externa, contrato de input (`{before, after}` JSON shallow) e fallback (creation event = só `after`; sem diff = empty state).
  8. **Action registry** sincronizado — confirmar lista exaustiva de slugs cruzando código + git log + audit_log production rows.
  9. **Estratégia de mock** dos integration tests — como simular `auth.admin.mfa.{listFactors,deleteFactor}` consistentemente em `break-glass-rpc.test.ts` (decisão: testar apenas a RPC SQL no integration suite; CLI é teste manual no runbook).
  10. **Reconciliação com `rbac_matrix.md`** — 3 ações novas (audit listing, login_attempts_admin read, break-glass execution) já mapeadas; spec confirma e documenta.

---

**Recomendação do @sprint-creator:** **Opção 2 — Opus** (forçada pela rubrica em 3 caminhos)

**Justificativa:**
Score 22 cap dispara item 1 da árvore. Integração com Supabase Auth Admin API (primeira utilização no projeto) dispara item 2. Lógica de negócio nova/ambígua em 10 pontos dispara item 3. Esta é a primeira sprint do projeto com **script CLI fora do app**, **rate limit sliding-window com double-scope (email + IP)**, **double-key validation com hash em settings**, e **renderer de diff pretty-printed** — qualquer drift em (a) atomicidade do rate limit, (b) failure mode dos hooks de login, (c) localização do hash break-glass, (d) ordem RPC→Auth Admin API, ou (e) filtragem RBAC por regex gera incidente de segurança classe G-21 (bypass de break-glass = owner silencioso) ou G-13 (brute force viável). O `@spec-writer` precisa fixar privilege model das 4 RPCs, schema canônico de `login_attempts_admin`, snippet canônico de modificação de `signInAdminAction` (Sprint 04+11), e o fluxo de rotação do `BREAK_GLASS_SECRET` antes do `@db-admin` mexer. Sprint 12 fecha a malha de observabilidade do ciclo admin — Sprint 13 (transições automáticas + origin isolation) já depende deste sprint para popular o audit slug `subscription.auto_expire`. O `@sanity-checker` valida contra RF-AUTH-4, RF-AUDIT-1..6, RF-ADMIN-8, RNF-SEC-8, RNF-OBS-2, INV-10, G-13, G-21, T-07, T-12, T-20 do PRD admin.

**Aguardando escolha do usuário:** responda ao Tech Lead com `"execute opção 2"` (recomendado) ou `"execute"` (aceita a recomendação). Opção 1 não é adequada aqui — a rubrica força Opção 2 por três caminhos independentes.

---

## 🔄 Execução

> Esta seção é preenchida durante a execução. Cada agente atualiza sua linha antes de reportar conclusão ao Tech Lead. O Tech Lead atualiza a linha do `@guardian` e a linha Git no encerramento.

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| PRD Técnico (Implementation Plan) | `@spec-writer` | ✅ Concluído | [`prds/prd_admin_12_audit_ui_rate_limit_break_glass.md`](../../prds/prd_admin_12_audit_ui_rate_limit_break_glass.md) — 11 seções + §0 com 10 decisões resolvidas + §3 com SQL canônico de 5 RPCs |
| Sanity Check | `@sanity-checker` | ✅ Concluído | APROVADO no Binary Approval Script (S0–S6 PASS); aprovação do PO 2026-04-28 |
| Banco de dados | `@db-admin` | ✅ Concluído | [`supabase/migrations/20260428120000_admin_12_audit_ui_rate_limit_break_glass.sql`](../../supabase/migrations/20260428120000_admin_12_audit_ui_rate_limit_break_glass.sql) — 1 tabela + 1 coluna + 5 RPCs + atualização PROJECT_CONTEXT.md §2/§3 D-7/§5f. 9/9 validações pós-migration PASS via MCP |
| Server Actions + helpers + CLI | `@backend` | ✅ Concluído | [`src/lib/audit/actionRegistry.ts`](../../src/lib/audit/actionRegistry.ts) + [`src/lib/rateLimit/adminLogin.ts`](../../src/lib/rateLimit/adminLogin.ts) + [`src/lib/actions/admin/audit.ts`](../../src/lib/actions/admin/audit.ts) (4 actions) + modificação [`admin-auth.ts`](../../src/lib/actions/admin/admin-auth.ts) (signInAdminAction) + [`scripts/break-glass.ts`](../../scripts/break-glass.ts) + [`docs/admin_area/runbook_break_glass.md`](../../docs/admin_area/runbook_break_glass.md) + tsx devDep + `.env.example` |
| Integration tests | `@qa-integration` | ✅ Concluído | [`tests/integration/admin-audit.test.ts`](../../tests/integration/admin-audit.test.ts) (24) + [`admin-rate-limit.test.ts`](../../tests/integration/admin-rate-limit.test.ts) (18) + [`admin-break-glass.test.ts`](../../tests/integration/admin-break-glass.test.ts) (10) — 52/52 passam, 0 skips. GATE 4.5 PASS (297/297 globais) |
| Frontend | `@frontend+` | ✅ Concluído | `/admin/audit` (listing + filters URL-state + keyset load-more) + `/admin/audit/[id]` (detail page com diff/JSON/metadata) + 5 componentes em [`src/components/admin/audit/`](../../src/components/admin/audit/) (AuditActionBadge, JsonView, DiffTable, AuditFilters c/ Dialogs Radix, AuditTable) + AdminSidebar item "Audit log" (History icon) + AdminLoginForm refatorado p/ chamar `signInAdminAction` (rate limit message literal). Re-delegação 1×: Guardian rejeitou `<details>`/comboboxes hand-rolled em AuditFilters; reescrito com `Dialog` do design system. Build PASS, lint sem novos warnings, GATE 5 estático 0 violações |
| Guardian | `@guardian` | ✅ Concluído | APROVADO no 2º round — 1ª rodada rejeitou 4 violações em AuditFilters.tsx (multi-select com `<details>`, 2 comboboxes hand-rolled, focus-ring ausente em items de dropdown); 2ª rodada após reescrita com `Dialog` + Radix Primitives — todas as violações resolvidas |
| Git | Tech Lead | ⬜ Pendente | — |

**Legenda:** ⬜ Pendente · ▶️ Em andamento · ✅ Concluído · ⏸️ Aguarda review · n/a — não aplicável
