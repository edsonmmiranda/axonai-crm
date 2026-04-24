# Sprint 02 (Admin Area): Platform Admins, RBAC Base e Normalização de Role

> **Nível:** STANDARD
> **Plano fonte:** [`docs/admin_area/sprint_plan.md`](../../docs/admin_area/sprint_plan.md) § Sprint 02
> **PRD fonte:** [`docs/admin_area/admin_area_prd.md`](../../docs/admin_area/admin_area_prd.md) § RF-ADMIN-1..3, RF-ADMIN-6, INV-3, INV-5, T-14, G-06, G-08, RNF-SEC-7
> **Observação:** é a Sprint 02 do **ciclo de planejamento da Área Administrativa**. Prefixo `sprint_admin_` é a convenção declarada no plano § 6.

---

## 🎯 Objetivo de Negócio

Introduzir o modelo de **platform admin** (membros da equipe Axon com poder administrativo) ancorado na organização interna criada no Sprint 01, proteger a invariante INV-3 (sempre existe ao menos um owner ativo) e resolver a inconsistência de role entre código e banco (D-5 do plano).

Este sprint **não entrega UI** — é infraestrutura de autorização. O primeiro exercício real dos helpers `requirePlatformAdmin`/`requirePlatformAdminRole` acontece no Sprint 04 (shell admin) e Sprint 05 (primeiro CRUD admin). Tentar entregar o shell aqui inflaria o escopo além do que a rubrica suporta.

**Por que agora:** é o pré-requisito técnico de todos os sprints 04+ da área admin (shell, CRUD de organizações, inspect, etc.). Sem o conceito de platform admin, não há como proteger rotas admin a partir do Sprint 04.

**Métrica de sucesso:**
- `platform_admins` criada com RLS FORCE, policy mínima que só permite leitura ao próprio admin/service role, e trigger `prevent_last_owner_deactivation` ativo.
- Edson identificado como `platform_admins` owner ativo via RPC `is_platform_admin(auth.uid())`.
- `SessionRole` no código alinhado ao DB (sem a string `'member'` em nenhum lugar de `src/`).
- Customer app `(app)/*` nunca importa `@/lib/auth/platformAdmin.ts` — validado por guard no GATE 4.

## 👤 User Stories

- Como **platform admin (futuro)**, quero ser identificado server-side em qualquer request, para que rotas admin dos sprints 04+ possam me autorizar sem JWT claim novo.
- Como **dono da Axon**, quero que o último owner ativo **não** possa ser desativado, para que a plataforma nunca entre em lockout via UI (T-14 → recuperação cai em break-glass, mas não por erro operacional trivial).
- Como **desenvolvedor**, quero que `ctx.role` seja o mesmo valor que o DB armazena, para que ramos de autorização não dependam de tradução frágil no `normalizeRole`.

## 🎨 Referências Visuais

- **Sprint sem UI.** Nenhum `page.tsx` novo, nenhuma rota nova, nenhum componente novo.
- Única edição no frontend: rewrite mecânico de `ctx.role === 'member'` para a nova forma canônica em ~25 arquivos de `src/app/(app)/**` (ver Escopo/Frontend). Zero mudança visual.

## 🧬 Reference Module Compliance

**Não aplicável.** Sprint de infra — sem módulo CRUD. Reference Module Copy aqui seria teatro.

O `@db-admin` segue padrões já estabelecidos:
- FORCE RLS em tabelas globais administrativas (precedente: `plans` no Sprint 01, ver [`docs/conventions/standards.md`](../../docs/conventions/standards.md) § "Exceções em `public.*`").
- Policies mínimas com SELECT restrito; mutações só via RPC `SECURITY DEFINER` (mesmo padrão de `plans`/`subscriptions`).
- RPCs com `REVOKE EXECUTE … FROM anon` explícito (armadilha registrada em [`docs/APRENDIZADOS.md`](../../docs/APRENDIZADOS.md) — 2026-04-24).

O `@backend` segue padrão de helpers server-only (`import 'server-only'` no topo) já usado em `src/lib/supabase/getSessionContext.ts` e `src/lib/actions/_shared/assertRole.ts`.

---

## 📋 Funcionalidades (Escopo)

### Backend

#### Banco de Dados (autor: `@db-admin`)

- [ ] **Registrar `platform_admins` como exceção em `public.*`** (catálogo global de operadores, não pertence a uma org-tenant): atualizar a tabela "Exceções em `public.*`" em [`docs/conventions/standards.md`](../../docs/conventions/standards.md). Justificativa: `platform_admins` aponta para `profiles.id` da org interna AxonAI (INV-5); não tem `organization_id` porque o próprio registro é escopado à org Axon via FK.

- [ ] **Tabela `platform_admins`** (FORCE RLS):
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT` — admin é um profile da org interna Axon.
  - `role text NOT NULL CHECK (role IN ('owner','support','billing'))` — os três papéis do MVP (RF-ADMIN-2).
  - `is_active boolean NOT NULL DEFAULT true`
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - `deactivated_at timestamptz` (NULL quando ativo)
  - `created_by uuid REFERENCES profiles(id)` (nullable só pelo seed inicial)
  - **UNIQUE parcial** em `(profile_id) WHERE is_active = true` — um profile não acumula múltiplas linhas ativas simultâneas.
  - **CHECK de coerência:** `(is_active = true AND deactivated_at IS NULL) OR (is_active = false AND deactivated_at IS NOT NULL)`.
  - **FK org interna (defesa INV-5):** trigger `BEFORE INSERT OR UPDATE` que valida `EXISTS (SELECT 1 FROM profiles p JOIN organizations o ON o.id = p.organization_id WHERE p.id = NEW.profile_id AND o.is_internal = true)`. Rejeita se `profile_id` não é membro de org `is_internal=true`.
  - Policies: SELECT permitido para o próprio profile (`profile_id = auth.uid()`) + `service_role`. Sem policy de INSERT/UPDATE/DELETE para `authenticated` — toda mutação é via RPCs `SECURITY DEFINER` (Sprint 11 faz o CRUD admin; neste sprint só há seed manual do primeiro owner).
  - `REVOKE EXECUTE ... FROM anon` explícito em todas as RPCs novas (armadilha registrada em APRENDIZADOS 2026-04-24).

- [ ] **Trigger `prevent_last_owner_deactivation`** (autor da lógica: `@db-admin`, valida G-08/INV-3):
  - Dispara em `BEFORE UPDATE ON platform_admins` quando:
    - `OLD.role = 'owner' AND OLD.is_active = true` (linha prestes a perder papel de owner ativo), **ou**
    - `OLD.is_active = true AND NEW.is_active = false` (desativação de qualquer admin — mas só bloqueia se o efeito deixar zero owners).
  - Bloqueia se `COUNT(*) FROM platform_admins WHERE role='owner' AND is_active=true AND id <> OLD.id` = 0.
  - Mensagem tipada: `RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='last_owner_protected'` (caller do Sprint 11 traduz).
  - **Também cobre DELETE** do último owner (BEFORE DELETE com mesma lógica) — cinto e suspensório. Por que DELETE: evita dropar fisicamente o último owner mesmo via service_role em scripts fora do break-glass.

- [ ] **RPC `is_platform_admin(target_profile_id uuid) RETURNS platform_admins`** — `SECURITY DEFINER`, `STABLE`:
  - Retorna a linha de `platform_admins` do `target_profile_id` se estiver ativa, ou NULL.
  - Valida que caller é ou o próprio `target_profile_id`, ou `service_role`. Se não, retorna NULL (opção conservadora — não vazar existência).
  - Assinatura pensada para chamada server-side barata a cada request admin (`STABLE` permite cache por query). Não substitui o trigger nem as policies — é o helper de leitura.
  - Idempotência no `CREATE OR REPLACE FUNCTION`. `REVOKE EXECUTE FROM anon`.

- [ ] **Seed do primeiro platform admin owner (Edson):**
  - **Via RPC dedicada `seed_initial_platform_admin_owner(target_profile_id uuid)`** `SECURITY DEFINER`, executável **apenas** se `COUNT(*) FROM platform_admins` = 0 (idempotência + defesa: não é bootstrap se já tem qualquer admin).
  - Valida pré-requisito: `target_profile_id` deve pertencer à org `slug='axon'` (criada no Sprint 01). Se profile não está na org interna, erro tipado.
  - Insere `platform_admins (profile_id, role='owner', is_active=true, created_by=target_profile_id)`.
  - Não é chamada pela migration em si — o runbook operacional do Sprint 02 documenta a sequência:
    1. Rodar a migration (cria tabela, trigger, RPC, `seed_initial_platform_admin_owner`).
    2. Garantir que o profile de Edson está vinculado à org `slug='axon'` (pode exigir UPDATE manual em `profiles.organization_id` se Edson hoje está em outra org — decisão no PRD Técnico).
    3. Executar `SELECT seed_initial_platform_admin_owner('<profile-id>');` manualmente, uma única vez.
  - O runbook `docs/admin_area/runbook_seed_owner.md` é criado neste sprint.

- [ ] **Migration idempotente** (`IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` antes de `CREATE TRIGGER`), com seção de rollback no topo como comentário (G-17): drop da tabela, trigger, RPCs. Rollback em staging antes de prod.

#### Código (autor: `@backend`)

- [ ] **Novo helper `src/lib/auth/platformAdmin.ts`** (`import 'server-only'` no topo):
  - `getPlatformAdmin(): Promise<{ role: 'owner'|'support'|'billing' } | null>` — consulta via RPC `is_platform_admin(auth.uid())`. Cache por request (`React.cache`).
  - `requirePlatformAdmin(): Promise<{ role: PlatformAdminRole }>` — retorna o admin ou chama `redirect('/admin/login?reason=unauthorized')`. No Sprint 02 a rota `/admin/login` ainda não existe (vem no Sprint 04); o redirect fica stub-seguro: se a rota é 404, o middleware do Sprint 04 lida. **Decisão para o `@spec-writer`:** redirect direto ou `notFound()` neste sprint? Recomendação: `notFound()` até Sprint 04 criar a rota.
  - `requirePlatformAdminRole(allowed: PlatformAdminRole[]): Promise<{ role: PlatformAdminRole }>` — wrapper que valida papel contra lista.
  - Tipo exportado: `PlatformAdminRole = 'owner' | 'support' | 'billing'`. **Explicitamente separado** de `SessionRole` (role de tenant) para sinalizar ortogonalidade (ver Matriz RBAC abaixo).

- [ ] **Normalização de role (D-5):** resolver divergência entre `SessionRole = 'owner'|'admin'|'member'` (código) e DB.
  - **Pré-requisito para `@spec-writer`:** validar **via live DB** qual é o CHECK constraint real atual em `profiles.role` e qual é o DEFAULT. O plano afirma `'owner','admin','user','viewer'` mas o [`docs/schema_snapshot.json`](../../docs/schema_snapshot.json) mostra `DEFAULT 'member'::text` e não expõe o CHECK. Consultar via SQL (`information_schema.check_constraints` ou `pg_constraint`) antes de desenhar a migration de normalização. Armadilha [SUPABASE] em APRENDIZADOS 2026-04-22 aplica aqui: migrations antigas são arqueologia.
  - **Decisão do `@spec-writer`** (alternativas):
    - **(A)** Se DB já tem CHECK IN `('owner','admin','user','viewer')`: migration **só** atualiza DEFAULT de `'member'` para `'user'` + UPDATE em linhas existentes `role='member'` → `'user'`. Código acompanha.
    - **(B)** Se DB tem CHECK IN `('owner','admin','member')`: migration redefine o CHECK, atualiza default, rebatiza `'member'` → `'user'`. Código acompanha. Rollback testado.
  - **Código acompanhando (qualquer caminho):**
    - `src/lib/supabase/getSessionContext.ts:7,20,28`: `SessionRole = 'owner' | 'admin' | 'user' | 'viewer'`; `VALID_ROLES` atualizado; fallback do `normalizeRole` vira `'user'` (papel menos privilegiado).
    - Rewrite mecânico em 25+ arquivos de `src/app/(app)/**` que hoje fazem `if (ctx.role === 'member')` → `if (ctx.role === 'user' || ctx.role === 'viewer')`. Lista exaustiva no PRD Técnico — gerada com `grep -rn "role === 'member'" src/` (hoje: 25 ocorrências em 25 arquivos; ver contagem na seção Edge Cases).
    - `viewer` é novo no código. **Decisão do `@spec-writer`:** `viewer` é equivalente a `user` para fins de gate "restrita a admins" neste sprint (ambos caem no early-return)? Recomendação: sim — diferenciação de `viewer` (read-only) vem em sprint futuro não listado no plano; por ora, agrupar com `user`.
  - **Zero mudança em `assertRole`** (`src/lib/actions/_shared/assertRole.ts`): o tipo `SessionRole` muda por debaixo, mas a API (`assertRole(ctx, ['owner','admin'])`) segue igual. Apenas **callers** que passam `'member'` explicitamente (se houver — `grep` confirma) são ajustados.

- [ ] **Guard de import isolation (preparação para G-04 no Sprint 04):**
  - Criar `scripts/check-admin-isolation.mjs` — script Node que varre `src/app/(app)/**` e falha se qualquer arquivo importar de `@/lib/auth/platformAdmin` (regex simples).
  - Integrar em `npm run build:check` se esse comando já existir; caso contrário, documentar no runbook e deixar integração para Sprint 04 (que adiciona mais regras).
  - **Decisão do `@spec-writer`:** adicionar ao `package.json` agora ou só no Sprint 04? Recomendação: adicionar agora como `npm run check:admin-isolation` standalone; Sprint 04 compõe no `build:check`.

#### Documentação (autor: `@backend`, co-assinado pelo Tech Lead)

- [ ] **Matriz RBAC `docs/admin_area/rbac_matrix.md`** (D-6 do plano, citado em RF-ADMIN-2):
  - Lista ações previstas nos sprints 04–13 do plano × papel (owner/support/billing).
  - Ações em cada linha: **literalmente** as RPCs e Server Actions nomeadas no plano (ex: `admin_suspend_organization`, `admin_change_plan`, `admin_extend_trial`, `admin_grant_limit`, `inspect_log`, `admin_create_platform_admin_invitation`, etc.). Não inventar ações — citar o plano.
  - Papéis:
    - **owner** — tudo, incluindo CRUD de platform_admins (RF-ADMIN-3).
    - **support** — leitura, inspect read-only (Sprint 08), criar/encerrar tickets futuros, **sem** tocar plans/subscriptions.
    - **billing** — CRUD de plans (Sprint 06), change-plan, extend-trial, cancel-subscription, **sem** tocar platform_admins nem audit log além de leitura do próprio.
  - Formato tabular enxuto. **Não é fonte autoritativa de implementação** — cada RPC dos sprints seguintes continua validando papel no próprio corpo. A matriz é o contrato humano que o `@spec-writer` dos sprints 05+ lê para saber o que gate em cada RPC.
  - Abertura: afirma explicitamente **ortogonalidade** entre `profiles.role` (tenant, customer app) e `platform_admins.role` (plataforma, admin app). Nenhuma conversão entre os dois.

- [ ] **Runbook `docs/admin_area/runbook_seed_owner.md`:**
  - Sequência operacional para executar o seed do primeiro owner em prod/staging.
  - Passos de verificação pós-seed (query SELECT, confirmação de que trigger dispara se tentar desativar).
  - Como **desfazer** se o seed for errado antes do Sprint 11 (janela de recovery curta: `UPDATE platform_admins SET is_active=false, deactivated_at=now()` falhará pelo trigger; a saída é truncar a tabela e re-rodar — documentar).

### Frontend

**N/A estrutural.** Nenhuma UI nova. As únicas edições de arquivos sob `src/app/(app)/**` são os rewrites mecânicos de `ctx.role === 'member'` → nova forma canônica (listados no PRD Técnico). São edits de uma linha por arquivo, sem impacto visual.

Os 25 arquivos atingidos estão listados em anexo no PRD Técnico (saída do grep). Sprint Creator não reproduz a lista aqui para não poluir — o `@spec-writer` formaliza.

---

## 🧪 Edge Cases (obrigatório)

- [ ] **Tentativa de desativar o último owner ativo via SQL direto** (simulando o ataque T-14): `UPDATE platform_admins SET is_active=false WHERE id='<last-owner-id>'` deve falhar com `SQLSTATE=P0001`, mensagem `last_owner_protected`. Testado em staging com a tabela seed+1 extra owner, depois removendo o extra e tentando remover o último.
- [ ] **Tentativa de DELETE do último owner** (cenário fora do CRUD mas possível via service_role): mesmo erro tipado. Cinto + suspensório.
- [ ] **Tentativa de INSERT em `platform_admins` com `profile_id` que não pertence à org interna:** trigger de validação INV-5 rejeita com erro tipado `profile_not_in_internal_org`.
- [ ] **Dois INSERTs concorrentes do seed inicial (janela de race):** o `WHERE COUNT(*)=0` dentro de `seed_initial_platform_admin_owner` não é suficiente sob concorrência — adicionar `SELECT ... FOR UPDATE` em linha sentinela ou usar `INSERT ... WHERE NOT EXISTS (...)` atômico. Decisão do `@spec-writer`.
- [ ] **Profile com 2 linhas em `platform_admins` — uma ativa (owner), outra inativa (billing legado):** UNIQUE parcial em `(profile_id) WHERE is_active=true` permite; trigger de last-owner não conflita porque conta só ativas. Cenário previsto para o Sprint 11 (trocar papel = desativar linha antiga + criar nova) — valida o modelo agora.
- [ ] **Caller com JWT anon tenta executar `is_platform_admin`:** `REVOKE EXECUTE FROM anon` garante 42501/function does not exist. Teste explícito.
- [ ] **Código do customer app `(app)/*` importando `@/lib/auth/platformAdmin` por engano:** o script `check-admin-isolation.mjs` falha com mensagem tipada apontando arquivo e linha. Simular adicionando o import em um arquivo de teste e validando que o script detecta.
- [ ] **Rewrite mecânico do `role === 'member'`:** 25 arquivos no inventário atual. Se o `grep` pós-refactor retornar qualquer ocorrência de `'member'` em `src/` (exceto `docs/` e `supabase/migrations/`), falha no critério de aceite.
- [ ] **Arquivo `getSessionContext.ts` normalizando `'member'` de DB legado (durante janela de upgrade):** o `normalizeRole` mapeia explicitamente `'member'` → `'user'` como transição. Após a migration de DB, esse mapping pode ser removido — mas fica no Sprint 02 por segurança. Comentário no código explica a transitoriedade.

## 🚫 Fora de escopo

- UI `(admin)/*` de qualquer tipo — **Sprint 04** (shell) e **Sprint 11** (CRUD de admins).
- Rota `/admin/login` — **Sprint 04**.
- Enforcement de MFA AAL2 server-side — **Sprint 04**.
- RPCs de CRUD de platform_admins (`admin_create_platform_admin_invitation`, `admin_deactivate_platform_admin` etc.) — **Sprint 11**.
- `platform_admin_invitations` (convite single-use com token) — **Sprint 11**.
- Audit log de ações admin — **Sprint 03**. Este sprint **não** grava audit (ainda não existe `audit_log`).
- Break-glass CLI — **Sprint 12**.
- Diferenciação funcional de `viewer` vs `user` no customer app — não previsto no plano admin; trata como equivalentes por ora.
- Migração do DEFAULT de `'member'` para `'user'` em todas as orgs com linha pre-existente — se o caminho (B) for escolhido, o UPDATE em massa de `role='member'` → `'user'` é parte deste sprint; se (A), só documentar.
- Deletar a constante `'member'` de fallback no `normalizeRole`: **não** deletar neste sprint — manter como mapping transitório para proteger janela de deploy.

---

## ⚠️ Critérios de Aceite

- [ ] Tabela `platform_admins` criada com FORCE RLS; policies refletem leitura própria + service_role.
- [ ] Trigger `prevent_last_owner_deactivation` ativo (UPDATE **e** DELETE); teste manual falha com `last_owner_protected` quando tentado em staging.
- [ ] RPC `is_platform_admin(target_profile_id)` executável por `authenticated` (só para si) e `service_role`; rejeitada para `anon` (`has_function_privilege('anon', ..., 'execute') = false`).
- [ ] RPC `seed_initial_platform_admin_owner(target_profile_id)` idempotente e rejeita se já existir qualquer linha em `platform_admins`.
- [ ] Seed do Edson como owner ativo executado em staging **e** prod; `SELECT * FROM platform_admins WHERE role='owner' AND is_active=true` retorna ≥ 1 linha.
- [ ] Helper `src/lib/auth/platformAdmin.ts` exportado com `getPlatformAdmin`, `requirePlatformAdmin`, `requirePlatformAdminRole`; **zero** chamada desses helpers em `src/app/(app)/**` nem em `src/lib/actions/**` — validado por `grep`.
- [ ] Script `scripts/check-admin-isolation.mjs` executa e falha corretamente quando um arquivo sob `(app)/*` tenta importar `@/lib/auth/platformAdmin`.
- [ ] `SessionRole` em `src/lib/supabase/getSessionContext.ts` é `'owner' | 'admin' | 'user' | 'viewer'` — sem `'member'` no tipo.
- [ ] `grep -rn "'member'" src/` retorna **apenas** ocorrências no `normalizeRole` (mapping legado `'member'` → `'user'`); nenhuma outra.
- [ ] Todos os 25 sites de `ctx.role === 'member'` reescritos para a nova forma; build passa; golden flows do customer app (login, criar lead, listar produtos, pipeline) rodam sem regressão.
- [ ] `docs/admin_area/rbac_matrix.md` existe, cobre as ações nomeadas nos sprints 04–13 do plano, papéis × ações.
- [ ] `docs/admin_area/runbook_seed_owner.md` existe com passos, verificações e procedimento de rollback do seed.
- [ ] [`docs/conventions/standards.md`](../../docs/conventions/standards.md) § "Exceções em `public.*`" inclui linha para `platform_admins` com justificativa e proteção compensatória.
- [ ] `supabase db push --dry-run` passa sem erro.
- [ ] `npm run build` passa.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] **Guardian aprova o código** (GATE 4), incluindo verificação específica de que `(app)/*` não importa `platformAdmin.ts`.

---

## 🤖 Recomendação de Execução

**Análise:**
- Nível: STANDARD
- Complexity Score: **12**
  - DB: 5 (cap — nova tabela com trigger, RPC validada, UNIQUE parcial, CHECK de coerência, migração do CHECK de `profiles.role` possível)
  - API: 2 (RPC + helpers de auth)
  - UI: 0 (sprint sem UI)
  - Business logic: 5 (invariante INV-3 via trigger, matriz RBAC nova, normalização de role com blast radius em 25 arquivos, decisão ortogonalidade platform_admin × profile_role)
  - Dependências: 0 externas, internas (Sprint 01 — `organizations.is_internal` + org `slug='axon'`)
- Reference Module: **não** (sprint de infra, não CRUD)
- Integração com API externa: **não**
- Lógica de negócio nova/ambígua: **sim** — matriz RBAC precisa ser fixada (D-6 do plano), política de `viewer` vs `user` a decidir, janela de compat `'member'` → `'user'` durante deploy, coerência entre CHECK atual do DB (a verificar) e o CHECK desejado.
- Ambiguity Risk: **alto** — blast radius do rewrite de role (25 arquivos) + invariante INV-3 não-trivial (trigger que bloqueia UPDATE **e** DELETE, precisa evitar deadlock em self-update) + decisão de redirect stub vs `notFound()` no `requirePlatformAdmin` antes do Sprint 04 existir.

---

### Opção 1 — SIMPLES (sem PRD)

- **Fluxo:** Tech Lead → `@db-admin` → `@backend` → `@guardian` → gates → `@git-master`
- **PRD:** pulado; sprint file é o contrato
- **Modelo sugerido:** N/A
- **Quando faz sentido:** **não faz sentido aqui.** Score 12, lógica de negócio nova/ambígua (matriz RBAC ortogonal + normalização de role) e uma nova tabela com trigger crítico de invariante. Três gatilhos da rubrica convergem; Opção 1 seria teatro.

### Opção 2 — COMPLETA (com PRD)

- **Fluxo:** Tech Lead → `@spec-writer` (Implementation Plan) → `@sanity-checker` (loop até 3×) → STOP & WAIT → `@db-admin` → `@backend` → `@guardian` → gates → `@git-master`
- **PRD:** gerado em `prds/prd_admin_02_platform_admins_rbac.md`
- **Modelo sugerido:** **Opus** (cold review + sanity-checker pagam em Opus; em Sonnet drifta)
- **Quando faz sentido:** **aqui.** Score ≥ 9 força Opção 2 (item 1 da árvore). Adicionalmente lógica de negócio nova (item 3) e múltiplas fontes de ambiguidade (matriz RBAC, normalização de role, ortogonalidade, trigger cobrindo UPDATE+DELETE). O `@spec-writer` precisa fixar antes da execução: (a) CHECK atual real de `profiles.role` via live DB, (b) caminho A vs B da normalização, (c) política `viewer`≡`user` no gate, (d) `notFound()` vs `redirect()` no `requirePlatformAdmin` pré-Sprint 04, (e) matriz RBAC preenchida com ações literais dos sprints 05+ do plano, (f) resolução do race no seed.

---

**Recomendação do @sprint-creator:** **Opção 2 — Opus** (forçada pela rubrica)

**Justificativa:**
Score 12 dispara Opção 2 forçada (item 1 da árvore de decisão). Três vetores independentes de risco convergem: invariante INV-3 via trigger cobrindo UPDATE+DELETE (caso errado deixa a plataforma dependente só de break-glass), normalização de role com blast radius de 25 arquivos no customer app (regressão silenciosa é o risco — um `ctx.role === 'user'` esquecido em gate crítico vira elevação de privilégio), e decisão de ortogonalidade `platform_admins.role` × `profiles.role` que precisa ficar explicitamente documentada antes de qualquer sprint admin subsequente. O `@spec-writer` precisa resolver o estado real do CHECK de `profiles.role` (live DB, não migrations), redigir a matriz RBAC com ações literais do plano, e desenhar a transição `'member'` → `'user'` com rollback. O `@sanity-checker` revalida contra o PRD admin (§ RF-ADMIN-1..6, INV-3, INV-5) e contra o plano (§ D-5, D-6). O custo de reverter este sprint em produção é alto — afeta auth em todo customer app.

**Aguardando escolha do usuário:** responda ao Tech Lead com `"execute opção 2"` (recomendado) ou `"execute"` (aceita a recomendação). Opção 1 não é segura aqui — a rubrica força Opção 2.

---

## 🔄 Execução

> Esta seção é preenchida durante a execução. Cada agente atualiza sua linha antes de reportar conclusão ao Tech Lead. O Tech Lead atualiza as linhas de `@guardian` e `@git-master`.

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| PRD Técnico (Implementation Plan) | `@spec-writer` | ✅ Concluído | `prds/prd_admin_02_platform_admins_rbac.md` |
| Sanity Check | `@sanity-checker` | ✅ Concluído (APPROVED 7/7) | — |
| Banco de dados | `@db-admin` | ✅ Concluído | `supabase/migrations/20260424170000_platform_admins_rbac.sql` |
| Server-side refactor + helpers | `@backend` | ✅ Concluído | `src/lib/auth/platformAdmin.ts` + edits em `getSessionContext.ts` + Topbar + Invitations + Team + 24 rewrites `(app)/*` + `scripts/check-admin-isolation.mjs` + `docs/admin_area/rbac_matrix.md` + `docs/admin_area/runbook_seed_owner.md` | `src/lib/auth/platformAdmin.ts` + edits em `getSessionContext.ts` + 25 rewrites de `(app)/*` + `scripts/check-admin-isolation.mjs` + `docs/admin_area/rbac_matrix.md` + `docs/admin_area/runbook_seed_owner.md` + linha em `docs/conventions/standards.md` |
| Guardian | `@guardian` | ✅ Concluído (APPROVED) | — |
| Git | `@git-master` | ⬜ Pendente | — |

**Legenda:** ⬜ Pendente · ▶️ Em andamento · ✅ Concluído · ⏸️ Aguarda review
