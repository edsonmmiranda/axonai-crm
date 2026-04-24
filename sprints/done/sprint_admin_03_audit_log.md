# Sprint 03 (Admin Area): Audit Log Transacional

> **Nível:** STANDARD
> **Plano fonte:** [`docs/admin_area/sprint_plan.md`](../../docs/admin_area/sprint_plan.md) § Sprint 03
> **PRD fonte:** [`docs/admin_area/admin_area_prd.md`](../../docs/admin_area/admin_area_prd.md) § INV-6, T-03, T-12, G-03, G-10
> **Observação:** Sprint 03 do ciclo Admin Area. Prefixo `sprint_admin_` conforme convenção do plano § 6. Infraestrutura pura — sem UI nova.

---

## 🎯 Objetivo de Negócio

Criar a infraestrutura de **audit log** que garante que toda ação sensível dos sprints 04–13 deixe rastro **na mesma transação** da mutation, sem nenhum caminho de UPDATE/DELETE via UI ou RPC.

O contrato estabelecido aqui é pré-requisito obrigatório para todos os sprints seguintes: qualquer Server Action sensível da área admin **deve** chamar `writeAudit(...)` dentro da mesma transação. Sem essa infra, os sprints de CRUD admin (05, 06, etc.) não podem ser executados em conformidade com o PRD.

**Por que agora:** G-03 (transacionalidade do audit) e G-10 (append-only) são gates que os sprints 05+ precisam poder provar. Sem a tabela e o helper prontos, sprints dependentes não passariam nesses gates.

**Métrica de sucesso:**
- `audit_log` criada com FORCE RLS e append-only enforçado via policies + trigger de deny.
- RPC `audit_write` operacional e executável exclusivamente por código server-side autorizado.
- Helper `writeAudit` exportado em `src/lib/audit/write.ts` e documentado em `docs/conventions/audit.md`.
- UPDATE e DELETE em `audit_log` rejeitados em qualquer role — incluindo `service_role`.

## 👤 User Stories

- Como **platform admin (futuro)**, quero que cada ação sensível que tomo seja registrada em log imutável, para que haja rastreabilidade de qualquer operação (RF-AUD-1, INV-6).
- Como **auditor interno da Axon**, quero poder ler o histórico de ações sem risco de edição retroativa, para que o log tenha valor probatório (T-12).
- Como **desenvolvedor**, quero um helper `writeAudit` de assinatura simples que eu possa chamar dentro de qualquer Server Action, para que a integração não crie atrito e o contrato seja respeitado consistentemente.

## 🎨 Referências Visuais

**Sprint sem UI.** Nenhuma rota nova, nenhum componente novo. A UI de visualização do audit log é **Sprint 12**.

## 🧬 Reference Module Compliance

**Não aplicável.** Sprint de infraestrutura — sem módulo CRUD. Sem Reference Module Copy.

O `@db-admin` segue os padrões já estabelecidos nos Sprints 01 e 02:
- FORCE RLS em tabelas globais administrativas (exceção `public.*` — sem `organization_id`).
- Mutações apenas via RPC `SECURITY DEFINER`.
- `REVOKE EXECUTE … FROM anon` explícito em todas as RPCs (armadilha registrada em APRENDIZADOS 2026-04-24).

---

## 📋 Funcionalidades (Escopo)

### Backend

#### Banco de Dados (autor: `@db-admin`)

- [ ] **Registrar `audit_log` como exceção em `public.*`** (catálogo global de eventos — não pertence a uma org-tenant; pertence à plataforma): atualizar a tabela "Exceções em `public.*`" em [`docs/conventions/standards.md`](../../docs/conventions/standards.md). Justificativa: `audit_log.target_organization_id` é nullable e referencia orgs como *target* do evento, não como escopo de tenant do *ator*.

- [ ] **Tabela `audit_log`** (FORCE RLS):
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `occurred_at timestamptz NOT NULL DEFAULT now()`
  - `actor_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL` — nullable: permite registrar eventos de sistema (cron, break-glass CLI).
  - `actor_email_snapshot text` — email no momento do evento (desacopla de possíveis mudanças futuras em `profiles`).
  - `action text NOT NULL` — slug do evento: `'org.suspend'`, `'subscription.change_plan'`, `'inspect.read_leads'`, etc. Sem CHECK (lista aberta — cada sprint adiciona suas ações; o `@spec-writer` do sprint seguinte referencia `docs/conventions/audit.md` para ver ações já registradas).
  - `target_type text NOT NULL` — ex: `'organization'`, `'subscription'`, `'plan'`, `'platform_admin'`.
  - `target_id uuid` — nullable: algumas ações não têm target único.
  - `target_organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL` — nullable: para eventos sem org alvo (ex: criar plano global).
  - `diff_before jsonb` — snapshot do registro **antes** da mutation (nullable quando ação é criação).
  - `diff_after jsonb` — snapshot do registro **depois** da mutation (nullable quando ação é deleção/suspensão).
  - `ip_address inet` — nullable (não confiável atrás de proxy sem `x-forwarded-for` verificável).
  - `user_agent text` — nullable.
  - `metadata jsonb` — informações adicionais livres (ex: `{ "reason": "..." }` em suspensões).
  - **Índices:**
    - `(actor_profile_id, occurred_at DESC)` — listagem por ator.
    - `(target_organization_id, occurred_at DESC)` — listagem por org (Sprint 12 UI + Sprint 05 detalhe de org).
    - `(action, occurred_at DESC)` — filtro por tipo de ação.
    - `occurred_at DESC` — listagem global.
  - **RLS policies:**
    - SELECT: platform admin ativo pode ler (`EXISTS (SELECT 1 FROM platform_admins WHERE profile_id = auth.uid() AND is_active = true)`). A granularidade por papel (owner vs support vs billing) é validada no código; a policy de banco é permissiva para qualquer platform admin — o filtro fino fica na camada de aplicação (Sprint 12 implementa a UI; esta sprint não).
    - **Nenhuma policy de INSERT para `authenticated`** — inserção exclusivamente via RPC `audit_write` (SECURITY DEFINER).
    - **Nenhuma policy de UPDATE.** Zero linhas.
    - **Nenhuma policy de DELETE.** Zero linhas.

- [ ] **Trigger de deny `audit_log_deny_update_delete`** (cinto + suspensório sobre as policies):
  - `BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW`
  - Corpo: `RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='audit_log_immutable'` — rejeita incondicionalmente, **em qualquer role incluindo `service_role`**.
  - Por que trigger além de policies: policies RLS não afetam `service_role`; o trigger é o único mecanismo que protege contra deleção acidental por scripts internos, break-glass mal configurado, ou futuras migrations. Esse é o G-10.

- [ ] **RPC `audit_write(action text, target_type text, target_id uuid, target_organization_id uuid, diff_before jsonb, diff_after jsonb, metadata jsonb, ip_address inet, user_agent text) RETURNS uuid`** `SECURITY DEFINER` `VOLATILE`:
  - Única via de inserção em `audit_log` a partir do código server-side.
  - Captura `actor_profile_id` e `actor_email_snapshot` via `auth.uid()` + `auth.email()` internamente — caller não passa actor (elimina risco de impersonation no log).
  - Insere e retorna o `id` da linha criada.
  - `REVOKE EXECUTE FROM anon` explícito. Execute permitido para `authenticated` e `service_role`.
  - Idempotência de definição: `CREATE OR REPLACE FUNCTION`.
  - **Não** usa transação própria — a função é chamada dentro da transação do caller, garantindo rollback conjunto se a mutation falhar (G-03).

- [ ] **Migration idempotente** (`IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS … CREATE TRIGGER`), com seção de rollback no topo como comentário (G-17): drop da tabela (cascade), trigger, RPC. Rollback testado em staging antes de prod.

#### Código (autor: `@backend`)

- [ ] **Helper `src/lib/audit/write.ts`** (`import 'server-only'` no topo):
  - `writeAudit(params: WriteAuditParams, request?: Request): Promise<string>` — wrapper de `audit_write`.
  - `WriteAuditParams`: `{ action: string; targetType: string; targetId?: string; targetOrganizationId?: string; diffBefore?: unknown; diffAfter?: unknown; metadata?: Record<string, unknown> }`.
  - Extrai `ip_address` de `request.headers.get('x-forwarded-for')` (primeiro IP da lista) ou `request.headers.get('x-real-ip')`. Se nenhum disponível ou formato inválido → passa `null` (nullable no DB).
  - Extrai `user_agent` de `request.headers.get('user-agent')` → nullable se ausente.
  - Usa o Supabase client server-side (`createClient` de `@/lib/supabase/server`).
  - Em caso de falha da RPC: **propaga o erro** (não silencia — audit falho deve rolar a transação da mutation, não apenas logar o problema).
  - **Tipo exportado:** `WriteAuditParams` (reutilizado por sprints seguintes).

- [ ] **Documentação `docs/conventions/audit.md`**:
  - **Contrato obrigatório:** toda Server Action sensível na área admin chama `writeAudit(...)` dentro da mesma transação.
  - **O que é "ação sensível":** qualquer mutation em `organizations`, `subscriptions`, `plans`, `platform_admins`, `plan_grants`, `platform_settings`, `feature_flags`, `legal_policies`, `platform_integration_credentials` — bem como qualquer leitura via Deep Inspect (Sprint 08).
  - **Tabela de ações registradas:** lista viva, atualizada a cada sprint. Formato: `| action slug | target_type | sprint | descrição |`. Seeds iniciais: vazia neste sprint (primeiras ações reais vêm no Sprint 05). Sprint Creator dos sprints seguintes appenda a esta tabela no sprint file.
  - **Padrão de slug:** `'<domínio>.<verbo>'` em snake_case. Exemplos: `'org.create'`, `'org.suspend'`, `'org.reactivate'`, `'subscription.change_plan'`, `'subscription.extend_trial'`, `'plan.archive'`, `'inspect.read_leads'`, `'break_glass.recover_owner'`.
  - **Nota sobre `ip_address`:** tratar como nullable + best-effort. Não é garantia de identidade — é evidência auxiliar.
  - **Nota sobre `diff_before`/`diff_after`:** nunca incluir campos sensíveis (senhas, tokens, `value_encrypted`). A exclusão de campos sensíveis é responsabilidade do caller.

### Frontend

**N/A.** Nenhuma UI neste sprint. A tela de visualização do audit log é **Sprint 12**.

---

## 🧪 Edge Cases (obrigatório)

- [ ] **UPDATE em `audit_log` (qualquer role, incluindo `service_role`):** deve falhar com `SQLSTATE=P0001`, mensagem `audit_log_immutable`. Validar explicitamente para `authenticated` **e** para `service_role` (via `supabase.rpc` sem RLS bypass e via SQL direto respectivamente).
- [ ] **DELETE em `audit_log` (qualquer role):** mesmo comportamento do UPDATE — trigger bloqueia antes de checar policies.
- [ ] **`audit_write` chamada sem usuário autenticado (anon):** deve retornar `42501` (permission denied) — `REVOKE EXECUTE FROM anon`. Testar diretamente via Supabase JS com client anon.
- [ ] **`writeAudit` chamada dentro de transaction que falha depois:** simular Server Action que chama `writeAudit` e depois lança erro — validar que a linha **não** persiste em `audit_log` (rollback conjunto, G-03).
- [ ] **`x-forwarded-for` com múltiplos IPs (proxy chain):** `"203.0.113.1, 10.0.0.1"` → deve extrair somente o primeiro (`203.0.113.1`). Header ausente ou malformado → `null`.
- [ ] **`diff_before`/`diff_after` com objeto vazio `{}`:** aceito — nullable é só para `null`, objeto vazio é dado válido.
- [ ] **`target_id` e `target_organization_id` nulos:** linha deve inserir sem erro (nullable explícito no schema). Cenário: criar plano global (sem org alvo).
- [ ] **Dois `writeAudit` concorrentes na mesma transação (ex: suspender org + criar entrada de audit em loop):** não há constraint que impeça — ambas inserem com UUIDs distintos. Sem deadlock.
- [ ] **Leitura de `audit_log` por usuário tenant (não platform admin):** policy SELECT não dá acesso → retorna vazio (não 403, pois RLS em Supabase retorna resultado vazio por padrão).

## 🚫 Fora de escopo

- UI de visualização do audit log — **Sprint 12**.
- Rate limit de login admin — **Sprint 12**.
- Audit das ações de CRUD de organizações — **Sprint 05** (este sprint só cria a infra; primeiras gravações reais vêm no Sprint 05).
- Retenção/TTL do audit log (D-7) — **Sprint 12** (coluna `retention_expires_at` reservada mas sem lógica).
- Filtro por papel no SELECT de `audit_log` (billing vê apenas ações de billing, support vê tudo) — aplicado na UI do Sprint 12; esta sprint deixa a policy de banco permissiva para qualquer platform admin ativo.
- Exportação/download do log — não previsto no plano admin MVP.
- Audit de ações do **customer app** (leads, produtos, etc.) — fora do escopo do ciclo admin inteiro.

---

## ⚠️ Critérios de Aceite

- [ ] Tabela `audit_log` criada com FORCE RLS; nenhuma policy de UPDATE ou DELETE presente (`SELECT COUNT(*) FROM pg_policies WHERE tablename='audit_log' AND cmd IN ('UPDATE','DELETE')` retorna 0).
- [ ] Trigger `audit_log_deny_update_delete` ativo; `UPDATE audit_log SET occurred_at=now() WHERE false` (statement-level) falha com `audit_log_immutable` mesmo usando `service_role`.
- [ ] RPC `audit_write` executável por `authenticated` e `service_role`; rejeitada por `anon` (`has_function_privilege('anon', 'audit_write(...)', 'execute') = false`).
- [ ] `writeAudit` inserção bem-sucedida retorna o `uuid` da linha; linha visível via SELECT com `service_role`.
- [ ] Rollback conjunto validado: Server Action que chama `writeAudit` e depois lança erro **não** deixa linha em `audit_log`.
- [ ] `docs/conventions/audit.md` existe, define o contrato ("toda Server Action sensível chama `writeAudit` na mesma transação"), o padrão de slug e a tabela de ações (pode estar vazia neste sprint).
- [ ] `src/lib/audit/write.ts` exporta `writeAudit` e `WriteAuditParams`; tem `import 'server-only'` no topo.
- [ ] `supabase db push --dry-run` passa sem erro.
- [ ] `npm run build` passa.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] `docs/conventions/standards.md` § "Exceções em `public.*`" inclui linha para `audit_log` com justificativa.
- [ ] **Guardian aprova o código** (GATE 4).

---

## 🤖 Recomendação de Execução

**Análise:**
- Nível: STANDARD
- Complexity Score: **12**
  - DB: 5 (cap) — nova tabela + trigger de deny + RPC SECURITY DEFINER + múltiplos índices + policies com lógica de platform_admin ativo
  - API: 2 — RPC + helper server-side
  - UI: 0 — sprint sem UI
  - Business logic: 5 — invariante append-only enforçada em duas camadas (policy + trigger), rollback conjunto obrigatório (G-03), contratos para sprints futuros fixados em `docs/conventions/audit.md`
  - Dependências: 1 (interna — consulta `platform_admins.is_active` na policy SELECT; depende do Sprint 02)
- Reference Module: **não** (sprint de infra)
- Integração com API externa: **não**
- Lógica de negócio nova/ambígua: **sim** — append-only via duas camadas independentes (policy + trigger), rollback conjunto da mutation com o audit, extração segura de IP atrás de proxy, contrato de caller para todos os sprints 05–13
- Ambiguity Risk: **médio** — estrutura da tabela está bem definida no plano; as ambiguidades são pontuais: (a) granularidade da policy SELECT (papel-por-papel vs qualquer platform admin ativo — decidido no sprint file como permissivo para simplificar), (b) comportamento exato do trigger para `service_role` (cinto + suspensório), (c) tratamento de `ip_address` sob proxy

---

### Opção 1 — SIMPLES (sem PRD)

- **Fluxo:** Tech Lead → `@db-admin` → `@backend` → `@qa-integration` → `@guardian` → gates → `@git-master`
- **PRD:** pulado; sprint file é o contrato
- **Modelo sugerido:** N/A
- **Quando faz sentido:** **não faz sentido aqui.** Score 12 força Opção 2 pela rubrica. O contrato do `audit_write` precisa ser fixado com precisão antes da execução — erros no trigger de deny ou no comportamento do rollback são difíceis de reverter em produção quando os sprints 05+ já dependem do contrato.

### Opção 2 — COMPLETA (com PRD)

- **Fluxo:** Tech Lead → `@spec-writer` (Implementation Plan) → `@sanity-checker` (loop até 3×) → STOP & WAIT → `@db-admin` → `@backend` → `@qa-integration` → `@guardian` → gates → `@git-master`
- **PRD:** gerado em `prds/prd_admin_03_audit_log.md`
- **Modelo sugerido:** **Opus** (cold review + sanity-checker pagam em Opus; em Sonnet drifta)
- **Quando faz sentido:** **aqui.** Score ≥ 9 força Opção 2 (item 1 da árvore). O `@spec-writer` precisa fixar antes da execução: (a) confirmação do comportamento exato do trigger de deny para `service_role` e como testá-lo sem cliente admin, (b) esquema de transação do `writeAudit` — a RPC deve usar a mesma conexão do caller para participar da transação? Sim, mas isso precisa ser explicitado no PRD (helper usa o Supabase client da request, não abre conexão nova), (c) extração de IP: qual header tem prioridade, o que fazer com IPs privados/loopback, (d) política de `diff_before`/`diff_after`: lista de campos a excluir por tipo de target (ou deixar para o caller?).

---

**Recomendação do @sprint-creator:** **Opção 2 — Opus** (forçada pela rubrica)

**Justificativa:**
Score 12 dispara Opção 2 forçada (item 1 da árvore de decisão). A criticalidade é assimétrica: esta sprint estabelece o contrato que **todos** os sprints 05–13 devem obedecer — um contrato mal especificado agora multiplica dívida técnica por 9 sprints. O `@spec-writer` precisa resolver dois pontos não-triviais antes da execução: (1) garantia de transacionalidade do `audit_write` — a função deve ser chamada na mesma conexão do caller para participar do `BEGIN`/`COMMIT` externo; isso não é automático com Supabase JS e precisa de decisão explícita de implementação; (2) comportamento do trigger de deny para `service_role` — RLS não se aplica a service_role, portanto o trigger é o único bloqueio e precisa ser testado de forma confiável em staging (o `@spec-writer` define o método de teste). O `@sanity-checker` revalida contra INV-6, T-03, T-12, G-03 e G-10 do PRD admin.

**Aguardando escolha do usuário:** responda ao Tech Lead com `"execute opção 2"` (recomendado) ou `"execute"` (aceita a recomendação). Opção 1 não é adequada aqui — a rubrica força Opção 2.

---

## 🔄 Execução

> Esta seção é preenchida durante a execução. Cada agente atualiza sua linha antes de reportar conclusão ao Tech Lead.

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| PRD Técnico (Implementation Plan) | `@spec-writer` | ✅ Concluído | `prds/prd_admin_03_audit_log.md` |
| Sanity Check | `@sanity-checker` | ✅ Concluído (APROVAÇÃO CONDICIONAL — B-1, B-2, B-3 passados como contexto ao @db-admin) | — |
| Banco de dados | `@db-admin` | ✅ Concluído | `supabase/migrations/20260424180000_audit_log.sql` |
| Server-side helper + docs | `@backend` | ✅ Concluído | `src/lib/audit/write.ts` · `docs/conventions/audit.md` · `docs/PROJECT_CONTEXT.md` |
| Integration tests | `@qa-integration` | ✅ Concluído | `tests/integration/audit.test.ts` · `vitest.config.ts` · `tests/setup.ts` — 10 testes, 0 falhas |
| Guardian | `@guardian` | ✅ Concluído (APPROVED) | — |
| Git | `@git-master` | ▶️ Em andamento | — |

**Legenda:** ⬜ Pendente · ▶️ Em andamento · ✅ Concluído · ⏸️ Aguarda review
