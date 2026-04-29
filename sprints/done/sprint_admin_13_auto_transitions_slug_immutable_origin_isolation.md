# Sprint admin_13: Transições automáticas + slug imutável pós-login + origin isolation de deploy (STANDARD)

> **Nível:** STANDARD
> **Origem:** [`docs/admin_area/sprint_plan.md`](../../docs/admin_area/sprint_plan.md) §4 — Sprint 13
> **PRD de referência:** [`docs/admin_area/admin_area_prd.md`](../../docs/admin_area/admin_area_prd.md)
> **Decisões fixadas:** D-2 (lazy + cron), D-3 (subdomínio dedicado), D-9 (SLA <15min)

---

## 🎯 Objetivo de Negócio

Fechar três obrigações de produto que ficaram em aberto até o último sprint do plano admin:

1. **Transições automáticas de status de subscription** (RF-SUB-6, RF-SUB-7, G-23) — hoje, após Sprint 06, `trial`/`past_due`/`cancelada` só viram `trial_expired`/bloqueada via lazy-check no middleware admin. Se ninguém abrir a área admin, o customer continua acessando além do permitido. SLA-alvo: <15min entre expiração efetiva e bloqueio.
2. **Slug imutável desde a criação** (RF-ORG-9, INV-9, G-20) — proteger URLs em uso, links de convite emitidos e integrações que cachearam o slug do cliente. **Decisão simplificada (2026-04-29):** slug é imutável desde a criação. Mudança operacional fica como runbook fora da UI.
3. **Origin isolation de deploy** (RNF-SEC-1, RNF-SEC-2, T-01) — PRD exige que o customer app **nunca** sirva rotas `(admin)`. Hoje o route group existe (Sprint 04), mas o mesmo hostname serve as duas árvores — basta digitar a URL certa. Subdomínio `admin.<host>` resolve.

**Métrica de sucesso:** trial com `period_end` no passado vira `trial_expired` em <15min sem intervenção manual; tentativa de PUT em slug pós-login falha com erro tipado; request a `/admin/dashboard` no host customer retorna 404.

## 👤 User Stories

- Como **platform admin owner**, eu quero que assinaturas expiradas/em atraso sejam bloqueadas automaticamente, para que receita fantasma e acesso indevido sejam contidos sem ação manual.
- Como **operador da Axon**, eu quero que o slug de uma org permaneça estável depois que o cliente começa a usar, para que URLs e links de convite não quebrem.
- Como **engenheiro de segurança**, eu quero que `/admin/*` não exista no host customer, para que comprometer o customer app não exponha sequer a tela de login admin (T-01).
- Como **customer user de uma org com trial vencido**, eu quero ver uma tela explicativa ("seu trial terminou, contate o suporte") em vez de 401/403 genérico, para entender o estado da minha conta.

## 🎨 Referências Visuais

- **Sem UI nova** neste sprint. Apenas middleware + DB + deploy ops.
- A tela de bloqueio do customer (status `trial_expired`/`suspensa`/`past_due` excedendo grace) já foi entregue no Sprint 05 quando o `is_active=false` virou policy de bloqueio. Este sprint reusa essa mesma superfície — basta a transição de status disparar.

## 🧬 Reference Module Compliance

Não aplicável — este sprint não cria CRUD nem módulo novo. Trabalho é em (a) DB primitives, (b) job agendado, (c) middleware/deploy.

## 📋 Funcionalidades (Escopo)

### Backend / DB (slug + transições)

- [ ] **Trigger `prevent_slug_change`** em `organizations` (BEFORE UPDATE OF slug) — `IF NEW.slug IS DISTINCT FROM OLD.slug THEN RAISE EXCEPTION 'org_slug_immutable' USING ERRCODE = 'P0001'`. Erro tipado para o frontend traduzir. UPDATE no-op (slug igual) é permitido para idempotência. Mudança operacional exige runbook (DROP TRIGGER → UPDATE → recreate).

- [ ] **RPC `admin_transition_subscriptions() returns table(transitioned int, by_status jsonb)`** `SECURITY DEFINER`:
  - `trial` com `period_end < now()` → UPDATE para `trial_expired`. Audit `'subscription.auto_expire'` por linha (chama `audit_write` do Sprint 03 com `actor_profile_id = NULL`, marca `metadata->>'source' = 'cron'`).
  - `past_due` com `period_end + (platform_settings.past_due_grace_days || ' days')::interval < now()` → UPDATE para `suspensa` (efeito de bloqueio idêntico). Audit `'subscription.auto_block_past_due'`.
  - `cancelada` com `period_end < now()` → UPDATE para `suspensa`. Audit `'subscription.auto_block_cancelled'`.
  - Idempotente: rodar duas vezes seguidas no mesmo segundo não duplica audit (filtra `WHERE status IN (...)` antes do update).
  - Retorna contagem por status para observabilidade.

- [ ] **pg_cron job `admin_transition_subscriptions_hourly`** — schedule `'0 * * * *'`, chama `admin_transition_subscriptions()`. **Decisão a tomar pelo `@db-admin` no preflight:** validar que pg_cron está habilitado no projeto Supabase. Se não estiver e habilitação exigir tier superior (T-19 risk), abrir issue de fallback para Edge Function + Vercel Cron com mesmo contrato (não bloqueia o sprint — fallback documentado no runbook).

- [ ] **RLS:** todas as alterações respeitam o que já existe. RPCs novas são `SECURITY DEFINER` (cron precisa rodar sem JWT).

- [ ] **Migration idempotente** com script de rollback testado (G-17).

### Backend / Código

- [ ] **Lazy-check mantido como cinto** (D-2): em `src/lib/middleware/admin.ts` (criado no Sprint 04), antes de servir qualquer rota admin que dependa de subscription, chamar a mesma RPC com `WHERE organization_id = ?`. Reutilizar o helper `checkAndUpdateExpiredTrials` introduzido no Sprint 06 — agora ele cobre os 3 status, não só `trial`. **Não duplique lógica entre middleware e RPC** — extraia para função SQL única chamada de ambos os lados.

- [ ] **Hostname gate no middleware do app** — `src/middleware.ts` (Next.js):
  - Lê `request.headers.get('host')`.
  - Se `host === process.env.NEXT_PUBLIC_ADMIN_HOST` → permite apenas paths que casam `/admin/*` ou route group `(admin)`. Qualquer outro path → 404.
  - Se `host === process.env.NEXT_PUBLIC_CUSTOMER_HOST` → recusa qualquer path `/admin/*` com 404. Customer continua normal.
  - Hosts vêm de env vars com fallback explícito (em dev local, `localhost:3000` é tratado como host único permissivo + warning de dev).
  - **Adicionar a `.env.example`:** `NEXT_PUBLIC_ADMIN_HOST=admin.example.com` e `NEXT_PUBLIC_CUSTOMER_HOST=app.example.com`.

- [ ] **Cookies de sessão com `domain` explícito + `SameSite=Strict`:**
  - Configurar Supabase auth helpers para emitir cookie com `domain` = host correspondente (sem `.<root>` que cobriria os dois).
  - Sessão admin emitida em `admin.<host>` não é enviada para `<host>`/`app.<host>` e vice-versa.
  - **Validar:** logout em um lado não invalida o outro (G-05 já coberto no Sprint 04, mas re-verificar com domain isolation real).

### Deploy / Ops

- [ ] **Configurar subdomínio `admin.<host>`** no provedor (Vercel) apontando para o mesmo deployment do app. Customer continua em `<host>` (ou `app.<host>`).
- [ ] **Runbook em `docs/admin_area/runbook_origin_isolation.md`:** passos de configuração DNS, vars de ambiente em produção, verificação smoke (curl `<host>/admin/login` → 404, curl `admin.<host>/admin/login` → 200), e procedimento de rollback (apontar `admin.<host>` para domínio sem app, ou desabilitar o middleware gate temporariamente via flag).

## 🧪 Edge Cases

- [ ] **Trial expirado durante janela de uso ativo:** customer está logado e fazendo request quando o cron flipa `trial → trial_expired`. Próximo request da org bloqueado pela policy de `is_active`. Sessão do user **não** é revogada — só os dados ficam inacessíveis. Documentar isso explicitamente; é comportamento esperado (não force logout).
- [ ] **Cron atrasa por X horas (ex: pg_cron pausado):** lazy-check no middleware admin garante que, quando admin abre a área admin tocando aquela subscription, transição acontece on-demand. Customer continua bloqueado pela policy `is_active`+`status` independente de o cron ter rodado ou não.
- [ ] **Tentativa de UPDATE em slug de qualquer org:** trigger rejeita SEMPRE (slug imutável desde criação). Operador legítimo precisa renomear via runbook fora da UI (DROP TRIGGER → UPDATE → recreate).
- [ ] **UPDATE no-op em slug (mesmo valor):** trigger permite (idempotência). UPDATE em outras colunas da mesma row sem tocar slug também passa.
- [ ] **Request a `admin.<host>/api/some-customer-endpoint`:** middleware retorna 404 (path não casa `/admin/*`). API customer só atende em customer host.
- [ ] **Request a `<host>/admin/login`:** middleware retorna 404 (não 403 — não queremos confirmar que a rota existe).
- [ ] **Mesmo browser logado em customer e admin (cross-tab):** sessões coexistem em cookies de domínios distintos. Logout em admin não desloga customer e vice-versa (RNF-SEC-1).
- [ ] **CSRF cross-origin:** com `SameSite=Strict`, request originado em `<host>` não envia cookie de `admin.<host>`. Server Action admin chamada de origin customer → falha de auth, não execução cega (T-11).
- [ ] **pg_cron indisponível:** sprint reporta no preflight do `@db-admin`, fallback Edge Function + Vercel Cron entra em sprint operacional separado se necessário. **Não tentar implementar os dois caminhos no mesmo sprint** — escolha uma.

## 🚫 Fora de escopo

- **Notificação ao customer da expiração de trial** (email "seu trial vai expirar em 3 dias") — vira sprint próprio se virar requisito de produto.
- **Política de retenção do `audit_log`** (D-7 ainda pendente) — decisão de produto separada.
- **Métricas/alertas do cron** (Grafana, dashboard de execução, paging em falha) — observabilidade ops.
- **Procedimento manual de mudança de slug pós-login** (referenciado em RF-ORG-9 como "procedimento fora da UI") — runbook ops separado, não código.
- **Integração com gateway de pagamento** que automaticamente flipa `past_due → ativa` quando boleto compensa — fase 2 do PRD (§5.2).
- **Multi-region deploy** ou edge cases de DNS propagation — runbook nomeia o passo, mas validação cross-region é ops.

## ⚠️ Critérios de Aceite

- [ ] Trial com `period_end < now()` é flipado para `trial_expired` em <15min após o cron rodar (validável manualmente em staging: insere `period_end = now() - interval '1 minute'`, espera o próximo tick, valida no DB).
- [ ] `past_due` excedendo `past_due_grace_days` é flipado para `suspensa`.
- [ ] `cancelada` com `period_end < now()` é flipado para `suspensa`.
- [ ] Toda transição automática gera linha em `audit_log` com `action` apropriada e `metadata->>'source' = 'cron'`.
- [ ] `UPDATE organizations SET slug = 'novo'` (qualquer org) falha com erro `org_slug_immutable` (P0001).
- [ ] `UPDATE organizations SET slug = OLD.slug` (no-op) passa silenciosamente.
- [ ] `UPDATE organizations SET name = 'X'` (sem tocar slug) passa normalmente.
- [ ] Request a `<host>/admin/login` retorna 404.
- [ ] Request a `admin.<host>/admin/login` retorna a tela de login.
- [ ] Request a `admin.<host>/dashboard` (path customer) retorna 404.
- [ ] Cookie de sessão admin tem `domain=admin.<host>` e `SameSite=Strict`; cookie customer tem `domain=<host>` e não é enviado para o admin.
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] Migration tem script de rollback testado em staging (G-17).
- [ ] Runbook de origin isolation existe em `docs/admin_area/runbook_origin_isolation.md` com passos de DNS, env vars e smoke test.
- [ ] **Guardian aprova o código** — gate único para compliance de design system (não aplicável aqui pois sem UI, mas Guardian valida convenções de Server Action e estrutura de migration).
- [ ] GATE 1 (DB): RLS presente onde aplicável; sintaxe SQL válida (dry-run).
- [ ] GATE 4.5 (integration tests): testes de transição automática (mockando `now()` ou usando timestamps explícitos) e de rejeição de update de slug. Inclui teste de hostname gate no middleware (pode usar `next-test-api-route-handler` ou equivalente).

---

## 🤖 Recomendação de Execução

**Análise:**
- Nível: STANDARD
- Complexity Score: **12** (DB: 1 trigger simples +2, 1 pg_cron job +3, 1 RPC com lógica de transição +2 = **7**; API: middleware reescrito +2 = **2**; UI: 0; Business logic: 3 regras de transição novas +3 = **3**; Dependências: pg_cron extension +3, Vercel domain config +1 = **4**) — score caiu de 15 para 12 após simplificação do slug em 2026-04-29
- Reference Module: não aplicável (sprint não é CRUD)
- Integração com API externa: não (mas tem dependência de extensão Supabase pg_cron — assimilável a integração de plataforma)
- Lógica de negócio nova/ambígua: **sim** — três regras de transição + interação cron ↔ lazy ↔ middleware. PRD especifica o **quê**, mas o **como** (locking, idempotência, ordem de status, tratamento de erro do cron) precisa de spec
- Ambiguity Risk: **médio** — `past_due_grace_days` lê de `platform_settings` com semântica que ainda não foi exercitada por job; comportamento de sessão durante flip mid-request precisa decisão explícita

---

### Opção 1 — SIMPLES (sem PRD)
- **Fluxo:** Tech Lead → @db-admin → @backend → @guardian → gates → commit
- **PRD:** pulado; o próprio sprint file é o contrato
- **Modelo sugerido:** Opus — score >9 não comporta Sonnet
- **Quando faz sentido:** apenas se Edson topa fixar as decisões deste sprint file como contrato sem cold review. Não recomendado dado o score e o ambiguity risk.

### Opção 2 — COMPLETA (com PRD)
- **Fluxo:** Tech Lead → @spec-writer → @sanity-checker (loop até 3×) → STOP & WAIT → @db-admin → @backend → @guardian → gates → commit
- **PRD:** gerado em `prds/prd_admin_13_auto_transitions_slug_origin.md` e validado
- **Modelo sugerido:** Opus
- **Quando faz sentido:** sprint final do plano admin; toca trigger em `auth.sessions` (Supabase-managed), pg_cron extension, hostname middleware e domain de cookies — quatro superfícies sensíveis. Cold review do `@spec-writer` + sanity check pagam o próprio custo aqui.

---

**Recomendação do @sprint-creator:** **Opção 2 — Opus**

**Justificativa:**
Score 12 dispara regra "≥ 9 → Opção 2 forçada". Adicionalmente, lógica de negócio nova nas três regras de transição (timing, idempotência, audit-by-cron sem actor humano) e dependências externas em duas plataformas (pg_cron na extensão Supabase, DNS/domain no Vercel). Errar a spec aqui significa ou customer bloqueado indevidamente (perda de receita) ou customer ainda acessando além do permitido (compliance + receita fantasma) — ambos com rastro mínimo no audit. Implementation Plan + sanity-checker pagam o próprio custo.

**Aguardando escolha do usuário:** responda ao Tech Lead com `"execute opção 1"` ou `"execute opção 2"` (ou aceite a recomendação dizendo apenas `"execute"`).

---

## 🔄 Execução

> Esta seção é preenchida durante a execução. Cada agente atualiza sua linha antes de reportar conclusão ao Tech Lead. O Tech Lead atualiza a linha do `@guardian`.

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| PRD (se Opção 2) | `@spec-writer` | ⬜ Pendente | — |
| Sanity check (se Opção 2) | `@sanity-checker` | ⬜ Pendente | — |
| Banco de dados (trigger slug + RPCs transição + pg_cron + ajuste is_calling_org_active) | `@db-admin` | ✅ Concluído | `supabase/migrations/20260429160000_admin_13_auto_transitions_slug_origin.sql` |
| Middleware + hostname gate + cookies + lazy-check | `@backend` | ✅ Concluído | `src/lib/middleware/hostnameGate.ts`, `src/middleware.ts` (atualizado), `src/lib/actions/admin/subscription-transitions.ts` + `.schemas.ts`, `.env.example` (atualizado) |
| Integration tests (transições + slug guard + hostname gate) | `@qa-integration` | ✅ Concluído | `tests/integration/admin-subscription-transitions.test.ts` (6 testes), `tests/integration/hostname-gate.test.ts` (15 testes) — 21/21 passing; suíte completa 318/318 |
| Frontend | `@frontend+` | n/a — sprint sem UI nova | — |
| Guardian | `@guardian` | ✅ Concluído | GATE 4 APROVADO — sem violações |
| Runbook origin isolation | Tech Lead | ✅ Concluído | `docs/admin_area/runbook_origin_isolation.md` |
| Git | Tech Lead | ▶️ Em andamento | — |

**Legenda:** ⬜ Pendente · ▶️ Em andamento · ✅ Concluído · ⏸️ Aguarda review
