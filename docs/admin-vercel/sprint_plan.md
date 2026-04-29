# Plano de Sprints — Deploy Produção Vercel (Axon AI CRM)

> **Input:** [`deploy_prd.md`](deploy_prd.md)
> **Fonte do estado atual:** código-fonte em `src/` + banco de produção consultado via Supabase MCP + ausência de `vercel.json`/`.vercel/` confirmando que não há deploy ativo.
> **Data:** 2026-04-29
> **Tipo:** planejamento de execução — cada sprint deste plano será materializado como um sprint file em `sprints/active/` via `@sprint-creator`.

---

## 1. Decisões de produto assumidas (defaults aprovados)

Resolvem o §10 do PRD antes de o plano começar. Alterar uma destas revisita o sprint correspondente.

| # | Decisão em aberto | Escolha |
|---|---|---|
| DV-1 | Domínio raiz | **`axonai.com`** (placeholder — substituir pelo domínio real escolhido). Subdomínios: `app.axonai.com` (customer) e `admin.axonai.com` (admin). |
| DV-2 | SMTP de produção | **Manter fallback offline (RF-SET-7) no MVP.** Convites de admin geram link copiável. SMTP real (Resend / SES) entra apenas quando volume justificar. Sprint 10 já entregou a infra. |
| DV-3 | Branch policy | **`main` = produção (deploy automático), PRs = preview deploys, `staging` = staging deploy** (criada no Sprint vercel_06). PR review obrigatório fica para quando o time crescer (>1 dev). |
| DV-4 | Staging deploy timing | **Continuous** — todo push em `staging` deploya. Custo zero adicional (Vercel Hobby suporta múltiplos projects). |
| DV-5 | Vercel plan | **Hobby (free)** no MVP. Upgrade para Pro quando: (a) bater 100GB bandwidth/mês, ou (b) precisar de password protection em previews, ou (c) precisar de multi-paralel builds. |
| DV-6 | Region Vercel | **`gru1` (São Paulo)** — latência mínima ao Supabase também em SP. |

Decisões diferidas que **cada sprint deve resolver no seu escopo**:
- DV-7 Plano Supabase staging → Sprint vercel_06 (Free tier ou Pro? Validar limite de projects na conta).
- DV-8 Política de retenção de Vercel logs → Sprint vercel_04 (default Vercel é 1h em Hobby; é suficiente?).

---

## 2. Estado atual — o que existe e o que falta

**Reutilizável (não mexer além do estritamente necessário):**
- ✅ Stack Next.js 15 + Supabase + TypeScript estável, 318 testes integration passing
- ✅ Banco em produção com schema admin_01..admin_13 aplicado (confirmado via introspecção)
- ✅ Edson seedado como platform admin owner ativo (`platform_admins.id=f0a52115...`, role=owner, is_active=true desde 2026-04-24)
- ✅ pg_cron job `admin_transition_subscriptions_hourly` ativo, 1 execução registrada
- ✅ Origin isolation **implementado** no código (Sprint admin_13) — função pura `evaluateHostnameGate`, middleware integrado, cookies isolados, 15 testes unitários do gate
- ✅ Runbook de origin isolation em [`docs/admin_area/runbook_origin_isolation.md`](../admin_area/runbook_origin_isolation.md)

**Gaps (materializáveis como sprints):**
- ❌ Nenhum `vercel.json` / pasta `.vercel/` no projeto — nunca foi conectado ao Vercel
- ❌ Sem domínio próprio
- ❌ Env vars `NEXT_PUBLIC_ADMIN_HOST` / `NEXT_PUBLIC_CUSTOMER_HOST` não setadas (gate roda em modo dev permissivo)
- ❌ `BREAK_GLASS_SECRET` hash NÃO está em `platform_settings` (confirmado via introspecção 2026-04-29) — CLI quebra em produção
- ❌ Allowed redirect URLs do Supabase Auth não contêm hosts de produção (ainda só `localhost:3000`)
- ❌ Sem suíte E2E formal (Playwright não instalado)
- ❌ Sem ambiente staging para testar rollback de migrations

---

## 3. Sequenciamento e dependências

```
vercel_01 (bootstrap Vercel + primeiro deploy axonai-crm.vercel.app)
   │
   ├── vercel_02 (domínio próprio app.axonai.com)
   │      │
   │      └── vercel_03 (origin isolation: admin.axonai.com + env vars + smoke)
   │             │
   │             └── vercel_04 (validações em prod + seed BREAK_GLASS_SECRET hash + checklist)
   │
   ├── vercel_05 (G-16: Playwright E2E + GitHub Actions)
   │
   └── vercel_06 (G-17: Supabase staging + Vercel staging + protocolo @db-admin adaptado)
```

**Caminho crítico para "produto público funcional":** vercel_01 → vercel_02 → vercel_03 → vercel_04. Ao fim do Sprint vercel_04, o Axon AI CRM está acessível em `app.axonai.com` (customer) e `admin.axonai.com` (admin), com toda a pilha admin validada.

**Sprints opcionais (dívidas técnicas):** vercel_05 e vercel_06 podem rodar em qualquer ordem após vercel_04, ou em paralelo se houver bandwidth.

---

## 4. Sprints

### Sprint vercel_01 — Bootstrap Vercel + primeiro deploy

**Nível:** STANDARD · **Modelo:** Sonnet / Opção 1 (configuração operacional, sem ambiguidade técnica — sequência de cliques + validação).

**Objetivo:** App acessível em URL pública gerada pelo Vercel (`axonai-crm.vercel.app` ou similar), com env vars de produção, build automático a cada push em `main`.

**Pré-requisitos operacionais (humano executa):**
- Conta Vercel ativa (free Hobby plan).
- Acesso ao repo GitHub `edsonmmiranda/axonai-crm`.

**Operacional (Edson + Tech Lead acompanha):**
- **Conectar Vercel ao GitHub:**
  1. Acessar [vercel.com/new](https://vercel.com/new).
  2. "Import Git Repository" → selecionar `edsonmmiranda/axonai-crm`.
  3. Vercel auto-detecta Next.js — não muda nada em Build Command / Output Directory.
  4. Region: selecionar `gru1` (São Paulo).
- **Configurar env vars (Production scope):**
  - `NEXT_PUBLIC_SUPABASE_URL` (mesmo valor de `.env.local`)
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (idem)
  - `SUPABASE_SERVICE_ROLE_KEY` (idem — esta é sensível, **nunca** expor como NEXT_PUBLIC)
  - `NEXT_PUBLIC_SITE_URL` = `https://axonai-crm.vercel.app` (provisório até domínio próprio)
  - `BOOTSTRAP_EMAIL_*` — deixar vazio inicialmente (fallback offline ativa)
  - `BREAK_GLASS_SECRET` — gerar valor aleatório (`openssl rand -hex 32`) e cofrar em local seguro; setar no Vercel
  - `BREAK_GLASS_OPERATOR` = `edsonmmiranda@gmail.com`
- **Trigger primeiro deploy:** automático após import.
- **Validar build:** acompanhar logs no painel Vercel; build deve completar em 2-3 min.

**Smoke tests pós-deploy (curl + browser):**
- [ ] `curl -sI https://axonai-crm.vercel.app | head -1` → `HTTP/2 200` ou redirect para `/login`
- [ ] Browser: acessar `/login` — tela renderiza
- [ ] Browser: signup com email teste → confirmar email → login → dashboard renderiza
- [ ] Browser: `/admin/login` renderiza (gate em modo dev permissivo, sem env vars de host ainda)

**Atualizações no Supabase (humano via Dashboard):**
- **Authentication → URL Configuration → Site URL:** atualizar para `https://axonai-crm.vercel.app`
- **Authentication → URL Configuration → Redirect URLs:** adicionar `https://axonai-crm.vercel.app/**`

**Critérios de aceite:**
- [ ] App responde com HTTP 200 (ou redirect válido) na URL Vercel.
- [ ] Login customer funciona em produção.
- [ ] Login admin chega na tela MFA enroll (e Edson consegue completar enrollment).
- [ ] Build automático configurado: push em `main` → deploy em ≤5min.
- [ ] Env vars sensíveis (`SUPABASE_SERVICE_ROLE_KEY`, `BREAK_GLASS_SECRET`) confirmadas como **não-public** (nunca prefixadas com `NEXT_PUBLIC_`).

**Riscos:** (1) build falhar por env var faltante — Vercel mostra erro claro; (2) auth flow falhar por Site URL desatualizado no Supabase — passo explícito incluso.

**Output esperado:** [`docs/admin-vercel/runbook_first_deploy.md`](runbook_first_deploy.md) (criado durante o sprint, documentando o setup feito).

---

### Sprint vercel_02 — Domínio próprio (`app.axonai.com`)

**Nível:** STANDARD · **Modelo:** Sonnet / Opção 1 (operacional puro: comprar domínio + DNS + SSL automático).

**Objetivo:** App acessível em `https://app.axonai.com` (ou domínio raiz acordado em DV-1) com SSL ativo. URL Vercel original (`axonai-crm.vercel.app`) continua funcionando como fallback durante a transição.

**Pré-requisitos operacionais:**
- Sprint vercel_01 concluído.
- Decisão sobre domínio raiz (DV-1) — placeholder `axonai.com` neste plano.

**Operacional (Edson):**
- **Comprar domínio** (se ainda não tem):
  - Registro.br: `axonai.com.br` (~R$40/ano).
  - Namecheap / Cloudflare Registrar: `axonai.com` (~$12-15/ano).
- **Adicionar domínio no Vercel:**
  1. Painel Vercel → Project Settings → Domains.
  2. "Add" → `app.axonai.com`.
  3. Vercel mostra registros DNS necessários (CNAME ou A record).
- **Configurar DNS no provedor:**
  - Adicionar registro CNAME `app` → `cname.vercel-dns.com` (ou A record conforme instrução do Vercel).
  - TTL: 300 (5 min) para propagação rápida.
- **Validar propagação:**
  ```bash
  dig +short app.axonai.com
  # Esperado: IPs do Vercel (76.76.21.x ou similar)
  ```
- **Atualizar env vars:**
  - `NEXT_PUBLIC_SITE_URL` = `https://app.axonai.com`
- **Atualizar Supabase Auth:**
  - Site URL → `https://app.axonai.com`
  - Redirect URLs → adicionar `https://app.axonai.com/**` (manter `https://axonai-crm.vercel.app/**` durante transição)
- **Trigger redeploy** (push qualquer commit em main, ou "Redeploy" no painel).

**Smoke tests:**
- [ ] `curl -sI https://app.axonai.com | head -1` → 200 ou redirect
- [ ] Browser: `https://app.axonai.com/login` — tela renderiza com SSL válido (cadeado verde)
- [ ] Browser: login customer completo a partir do novo domínio
- [ ] Browser: `https://app.axonai.com/admin/login` ainda renderiza (gate ainda em modo dev permissivo — sem env vars de host)
- [ ] HTTP redireciona para HTTPS: `curl -sI http://app.axonai.com | grep -i location` → `https://app.axonai.com`

**Critérios de aceite:**
- [ ] `https://app.axonai.com` responde com SSL válido (Let's Encrypt via Vercel).
- [ ] Login customer + admin funcionam no domínio novo.
- [ ] Supabase Auth redirect URLs atualizadas (verificável: signup → email de confirmação → link aponta para `app.axonai.com`).
- [ ] DNS propagado (`dig` confirma).

**Riscos:** (1) propagação DNS lenta — aceitar até 24h em casos extremos; (2) email de confirmação Supabase com URL antiga — limpar cache + reconfirmar no painel.

**Output esperado:** [`docs/admin-vercel/runbook_domain_setup.md`](runbook_domain_setup.md).

---

### Sprint vercel_03 — Ativação do origin isolation (`admin.axonai.com`)

**Nível:** STANDARD · **Modelo:** Sonnet / Opção 1 (configuração + smoke tests; código já está pronto desde Sprint admin_13).

**Objetivo:** Área admin servida exclusivamente em `https://admin.axonai.com`. Customer host (`app.axonai.com`) recusa qualquer rota `/admin/*` com 404. Cookies de sessão isolados por domain.

**Pré-requisitos:**
- Sprints vercel_01 e vercel_02 concluídos.
- Código de origin isolation já entregue (Sprint admin_13) — sem mudança de código neste sprint.

**Operacional (Edson):**
- **Adicionar segundo domínio no Vercel** (mesmo project, mesmo deployment):
  1. Project Settings → Domains → Add `admin.axonai.com`.
  2. Vercel mostra registros DNS.
- **Configurar DNS:**
  - CNAME `admin` → `cname.vercel-dns.com`.
- **Validar propagação:**
  ```bash
  dig +short admin.axonai.com
  ```
- **Adicionar env vars (Production scope):**
  ```
  NEXT_PUBLIC_ADMIN_HOST=admin.axonai.com
  NEXT_PUBLIC_CUSTOMER_HOST=app.axonai.com
  ```
- **Atualizar Supabase Auth → Redirect URLs:** adicionar `https://admin.axonai.com/**`.
- **Trigger redeploy:** Vercel não recarrega env vars sem novo deploy.

**Smoke tests (do runbook [`docs/admin_area/runbook_origin_isolation.md`](../admin_area/runbook_origin_isolation.md) §3):**
- [ ] `curl -sI https://admin.axonai.com/admin/login | head -1` → `HTTP/2 200`
- [ ] `curl -sI https://app.axonai.com/admin/login | head -1` → `HTTP/2 404`
- [ ] `curl -sI https://admin.axonai.com/dashboard | head -1` → `HTTP/2 404`
- [ ] `curl -sI https://app.axonai.com/dashboard | head -1` → `HTTP/2 200` ou redirect

**Smoke tests de cookies (DevTools):**
- [ ] Login admin em `https://admin.axonai.com/admin/login`
- [ ] Application → Cookies: cookie `sb-<project-ref>-auth-token` tem `Domain: admin.axonai.com` (sem dot prefix), `SameSite: Strict`, `Secure: true`
- [ ] Em outra aba: `https://app.axonai.com` — Network → cookie de admin **não** aparece nos request headers
- [ ] Login customer em `https://app.axonai.com/login` cria cookie separado com `Domain: app.axonai.com`

**Critérios de aceite:**
- [ ] Os 4 smoke tests de curl passam exatamente como esperado.
- [ ] Cookies isolados confirmados via DevTools.
- [ ] Logout em admin não desloga customer (e vice-versa).
- [ ] `dig admin.axonai.com` resolve.

**Riscos:** (1) cookies persistem com domain antigo (sem `.axonai.com`) — limpar cookies do site e relogar; (2) request a `admin.axonai.com` retorna 503 — env vars mal configuradas, ver troubleshooting do runbook §6.

**Output esperado:** atualização de [`docs/admin_area/runbook_origin_isolation.md`](../admin_area/runbook_origin_isolation.md) §7 (histórico) com data de ativação real.

---

### Sprint vercel_04 — Validações em produção + seed `BREAK_GLASS_SECRET` + checklist

**Nível:** STANDARD · **Modelo:** Sonnet / Opção 1 (operacional + bateria de smoke tests; sem código novo).

**Objetivo:** Confirmar que toda a pilha do admin (entregue em 12 sprints) funciona em produção real, e fechar pendências bloqueantes (especificamente: seed do `BREAK_GLASS_SECRET` hash, sem o qual o CLI break-glass não funciona).

**Pré-requisitos:**
- Sprints vercel_01..vercel_03 concluídos.

**DB (humano via Supabase Dashboard SQL Editor — operação sensível):**
- **Seedar `BREAK_GLASS_SECRET` hash em `platform_settings`** (pendência confirmada em 2026-04-29):
  ```sql
  -- O valor de BREAK_GLASS_SECRET foi gerado e setado no Vercel no Sprint vercel_01.
  -- Aqui inserimos o HASH (não o valor) em platform_settings.
  -- Substituir <HASH> pelo SHA-256 hex do BREAK_GLASS_SECRET.
  -- Comando no terminal local (sem subir o secret em lugar nenhum):
  --   echo -n "<BREAK_GLASS_SECRET>" | sha256sum
  INSERT INTO public.platform_settings (key, value_type, value_text, description)
  VALUES (
    'break_glass_secret_hash',
    'text',
    '<HASH_SHA256_HEX>',
    'SHA-256 do BREAK_GLASS_SECRET. Lido por get_break_glass_secret_hash() no break-glass CLI. Rotação em cadência distinta da service role.'
  )
  ON CONFLICT (key) DO UPDATE SET value_text = EXCLUDED.value_text, updated_at = now();
  ```
- **Confirmar via:**
  ```sql
  SELECT key, length(value_text) AS hash_len FROM platform_settings WHERE key = 'break_glass_secret_hash';
  -- Esperado: hash_len = 64 (SHA-256 hex)
  ```

**Smoke tests funcionais (browser + curl, em produção real):**

**A. Customer flow:**
- [ ] Signup novo: `https://app.axonai.com/signup` → tela renderiza ou retorna feedback adequado se desabilitado (RF-D1)
- [ ] Login com user existente: dashboard renderiza
- [ ] Criar lead → persiste, aparece na lista
- [ ] Criar product → persiste
- [ ] Criar funnel → persiste
- [ ] Logout → cookie removido, retorna pra tela de login

**B. Admin flow:**
- [ ] Login admin Edson em `https://admin.axonai.com/admin/login`
- [ ] MFA challenge (Edson já tem TOTP enrolado): completar
- [ ] Dashboard admin: 3 KPIs aparecem (orgs ativas, users totais, leads totais)
- [ ] `/admin/organizations`: listagem renderiza, paginação funciona
- [ ] Criar org cliente nova via UI: aparece na lista, gera audit row
- [ ] Suspender org criada: customer dessa org bate em `/conta-suspensa` ao tentar logar
- [ ] Reativar: acesso volta
- [ ] Trocar plano: limites mudam, audit row gerado
- [ ] `/admin/audit`: lista mostra as ações acima

**C. Pilha de segurança:**
- [ ] Rate limit admin login: 6 tentativas falhas em ≤10min com email errado → 429 + audit row `auth.login_rate_limited`
- [ ] Convite admin novo: gera link copiável (email não configurado → fallback offline ativa); link funciona se aberto em browser limpo
- [ ] Slug imutável: tentar `UPDATE organizations SET slug='novo' WHERE id=...` (via SQL Editor) → falha com `org_slug_immutable`

**D. Pilha de subscription transitions:**
- [ ] `cron.job_run_details` mostra ≥1 execução nas últimas 2h
- [ ] Manualmente (SQL Editor): `UPDATE subscriptions SET period_end = now() - interval '1 hour' WHERE id=<test_sub>` em uma org de teste com `status='trial'` → na próxima execução do cron (top of next hour), status flipa para `trial_expired`, audit row gerado

**Atualizar PROJECT_CONTEXT.md:**
- Documentar URL de produção em §1.
- Adicionar `break_glass_secret_hash` confirmado como seedado em §5f (Sprint admin_12 referencia mas não confirmava).
- Atualizar §4 (pendências operacionais) — esta sprint encerra a pendência do `BREAK_GLASS_SECRET`.

**Critérios de aceite:**
- [ ] Todos os 30+ checks acima passam em produção.
- [ ] `BREAK_GLASS_SECRET` hash seedado (verificável via `get_break_glass_secret_hash()` retornar valor não-NULL).
- [ ] Audit log tem rows das ações de teste executadas (Edson como `actor_email_snapshot`).
- [ ] PROJECT_CONTEXT.md atualizado.

**Output esperado:** [`docs/admin-vercel/runbook_production_smoke_tests.md`](runbook_production_smoke_tests.md) — checklist permanente para re-rodar a cada release maior.

---

### Sprint vercel_05 — Suíte E2E formal (G-16 Playwright)

**Nível:** STANDARD · **Modelo:** Opus / Opção 2 (instalação de framework novo + 7+ cenários + integração CI — score ~12 pelas dependências externas).

**Objetivo:** Atender G-16 do PRD admin (`docs/admin_area/admin_area_prd.md` §7.8): suíte de regressão de fluxos golden rodando automaticamente em CI, bloqueando merge se qualquer cenário falhar. Cobre o gap identificado no veredito do plano admin (2026-04-29).

**Pré-requisitos:**
- Sprint vercel_04 concluído (produção estável e validada).

**Backend (`@backend` ou Tech Lead):**
- **Instalar Playwright:**
  ```bash
  npm install --save-dev @playwright/test
  npx playwright install --with-deps chromium
  ```
- **Configuração `playwright.config.ts`:**
  - `testDir: './tests/e2e'`
  - `baseURL: process.env.E2E_BASE_URL` (preview deploy URL ou production)
  - Rodar headless por padrão; UI mode local opcional
  - Browser: chromium-only no MVP (paralelizar com firefox/webkit em fase 2)
  - Retry: 1 retry em CI, 0 local
  - Reporter: `html` + `list`
- **Estrutura `tests/e2e/`:**
  ```
  tests/e2e/
    fixtures/
      users.ts          # contas de teste (customer + admin)
      seed.ts           # criar/destruir dados de teste
    customer-login.spec.ts
    customer-signup.spec.ts
    admin-login-mfa.spec.ts
    admin-onboard-org.spec.ts
    admin-suspend-org.spec.ts
    admin-change-plan.spec.ts
    admin-invite-admin.spec.ts
  ```
- **Cenários golden (mínimo 7):**
  1. **Customer login:** abrir `/login` → preencher → dashboard renderiza
  2. **Customer signup:** abrir `/signup` (se habilitado) → criar conta → confirmar email mockado → dashboard
  3. **Admin login com MFA:** abrir `/admin/login` → email/senha → MFA challenge (TOTP fixture) → dashboard admin
  4. **Admin onboarda org cliente:** criar org → preencher → confirmar criação → org aparece na lista
  5. **Admin suspende org:** clicar em org → suspender → confirmar → customer dessa org não consegue logar (tela `/conta-suspensa`)
  6. **Admin troca plano:** clicar em org → trocar plano → confirmar → limites visualmente atualizados
  7. **Admin convida outro admin:** convidar email → link gerado (offline fallback) → abrir link → completar enrollment → novo admin aparece na lista
- **Helpers:**
  - `tests/e2e/fixtures/users.ts` — cria user customer + user admin com MFA pré-enrolado em hook `beforeAll` (via Supabase service client)
  - `tests/e2e/fixtures/seed.ts` — destrói dados de teste em `afterAll`
- **Scripts em `package.json`:**
  ```json
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui"
  ```

**CI (`.github/workflows/e2e.yml`):**
- Trigger: PR aberto / sincronizado.
- Steps:
  1. Aguardar Vercel preview deploy ficar pronto (action `patrickedqvist/wait-for-vercel-preview` ou similar)
  2. Setup Node 20 + cache npm
  3. `npm ci`
  4. `npx playwright install --with-deps chromium`
  5. `npm run test:e2e` com `E2E_BASE_URL=<preview_url>`
  6. Upload `playwright-report/` como artifact se falhar
- **Required check** no GitHub branch protection: PR não merga se E2E falhar.

**Riscos:**
- **Flakiness:** cenários dependentes de timing podem ficar instáveis. Mitigação: usar `page.waitFor*` explícitos em vez de `setTimeout`; retry 1x em CI.
- **MFA TOTP em fixture:** TOTP usa `otplib` server-side com secret pré-conhecido. Documentar geração no fixture.
- **Dados de teste em produção:** PRD §RNF-DPER-3 diz que admin não deve degradar customer. Solução: rodar E2E contra **preview deploy** (ambiente isolado), não produção. Org cliente "test-fixture-*" criada/destruída a cada run.
- **Cron de subscription transitions** rodando durante E2E pode interferir. Mitigação: testes não dependem de timing do cron.

**Critérios de aceite:**
- [ ] `npm run test:e2e` roda local em ≤2min (cenários paralelizados)
- [ ] GitHub Actions roda E2E a cada PR; merge bloqueado se qualquer cenário falhar
- [ ] 7 cenários golden cobertos
- [ ] Tempo total CI ≤10min (incluindo wait pelo preview)
- [ ] Documentado em [`docs/admin-vercel/runbook_e2e_playwright.md`](runbook_e2e_playwright.md)

---

### Sprint vercel_06 — Ambiente staging + rollback testado (G-17)

**Nível:** STANDARD · **Modelo:** Opus / Opção 2 (criação de ambiente paralelo + adaptação de protocolo do `@db-admin` + runbook detalhado — score ~13).

**Objetivo:** Atender G-17 do PRD admin (`docs/admin_area/admin_area_prd.md` §7.8): "Toda migration estrutural tem script de rollback testado em ambiente de staging antes de chegar em prod." Fechar a segunda dívida técnica do veredito.

**Pré-requisitos:**
- Sprints vercel_01..vercel_04 concluídos (produção estável).

**Decisão técnica a resolver no preflight:**
- **Supabase staging:** projeto separado vs Supabase Branching (preview branches)?
  - **Project separado:** funciona em qualquer plano; custo: 1 project Free a mais (limite Free: 2 projects).
  - **Branching:** mais elegante (cópia rápida do schema), mas exige Pro plan ($25/mês).
  - **Decisão default:** project separado no Free tier. Migrar para Branching quando upgrade pro Pro for justificado por outras razões.

**DB / Setup (humano):**
- **Criar projeto Supabase staging:**
  - Nome: `axonai-crm-staging`
  - Region: `gru1` (mesma de prod)
  - Plano: Free
- **Sincronizar schema staging com prod:**
  - Exportar schema atual de prod (sem dados): `supabase db dump --schema-only -p <prod-ref>` ou via Dashboard → Database → Backups
  - Importar em staging: aplicar todas as migrations em sequência via `supabase db push` apontando para staging
  - **Confirmar paridade:** comparar `\dt`, `\df`, e `cron.job` entre os dois bancos
- **Seed mínimo em staging:** org `axon` interna + 1 platform admin owner de teste (email `staging-admin@axonai.com`)

**Vercel (humano):**
- **Criar segundo Vercel project:** `axonai-crm-staging`
  - Mesmo repo, branch tracking: `staging`
  - Env vars apontando para Supabase staging
  - Domínio: pode ficar em `axonai-crm-staging.vercel.app` (sem domínio custom no MVP)
- **Criar branch `staging`** no GitHub:
  ```bash
  git checkout -b staging
  git push -u origin staging
  ```
- **Branch protection:** `staging` permite force-push (é descartável); `main` permanece protegida.

**Adaptar protocolo do `@db-admin`:**
- **Editar `agents/ops/db-admin.md`** — adicionar seção "Pre-flight de migration":
  ```markdown
  ## Pre-flight de migration (G-17)

  Antes de aplicar migration em produção:

  1. Criar branch `staging-migration-XX` a partir de `staging`.
  2. Adicionar migration nova em `supabase/migrations/`.
  3. Push pra `staging-migration-XX` → preview deploy do staging Vercel.
  4. Aplicar migration em Supabase staging via `supabase db push --db-url <staging-url>`.
  5. Validar smoke tests em staging.
  6. **Aplicar rollback** (script `--down` ou statements `DROP/ALTER REVERSE` documentados na seção §11 do PRD).
  7. **Confirmar estado idêntico ao pré-migration:**
     ```sql
     -- Comparar via probe RPCs:
     SELECT * FROM get_schema_tables();
     SELECT * FROM get_table_columns('<tabela_afetada>');
     SELECT * FROM get_table_indexes('<tabela_afetada>');
     ```
  8. Reaplicar a migration. Validar idempotência.
  9. Só então: merge staging → main → apply em prod.

  **Bloqueio:** se rollback falha ou estado diverge, escale ao Tech Lead. Não aplicar em prod.
  ```

**Runbook documentando o ciclo:** [`docs/admin-vercel/runbook_staging_rollback.md`](runbook_staging_rollback.md).

**Critérios de aceite:**
- [ ] Projeto Supabase staging existe e tem schema idêntico a prod.
- [ ] Vercel project staging deploya a cada push em `staging`.
- [ ] Login admin de staging funciona em `axonai-crm-staging.vercel.app`.
- [ ] Migration de teste (ex.: `ADD COLUMN IF NOT EXISTS foo text` em tabela qualquer) aplicada e revertida em staging com sucesso, estado idêntico antes/depois.
- [ ] `agents/ops/db-admin.md` atualizado.
- [ ] Runbook publicado.

**Riscos:**
- **Drift staging vs prod:** sem disciplina, staging fica desatualizado. Mitigação: protocolo do `@db-admin` exige sync antes de cada migration.
- **Custo Free tier Supabase:** limite de 2 projects ativos. Se já está usando 2, planejar upgrade.

---

## 5. O que este plano NÃO cobre (intencionalmente)

- **Custom email transacional** (Resend / SES) — fallback offline + bootstrap SMTP (Sprint admin_10) basta para MVP. Vira sprint próprio quando volume justificar.
- **CDN dedicado / cache estratégico** — Vercel edge basta. Otimizações finas em fase 2.
- **Monitoring stack** (Sentry, Datadog, Grafana) — logs nativos do Vercel + Supabase suficientes no MVP. Adicionar quando alguma incidente provar necessidade.
- **Multi-region deploy** — `gru1` cobre Brasil. Globalização vira fase 2.
- **Disaster recovery formal** (backup off-site, RTO/RPO documentados) — Supabase Pro tem PITR de 7 dias. Suficiente para MVP.
- **Vercel Pro upgrade** — esperar bater limites do Hobby. Decisão por sintoma, não preventiva.
- **Pipeline CI complexo** (lint + test + build + e2e em paralelo, deploy gates manuais, etc.) — GitHub Actions simples basta. Fluxo elaborado vira projeto quando o time crescer.
- **Password protection em previews** — feature do Vercel Pro. Hobby não suporta. Manter previews públicos no MVP (cuidado: não criar dados sensíveis em previews).
- **Wildcard SSL** (`*.axonai.com`) — Vercel emite cert por subdomínio adicionado. Wildcard não é necessário no MVP.

---

## 6. Próximos passos

1. **Revisar este plano** com Edson — especialmente DV-1 (qual domínio raiz?) e DV-2 (manter SMTP fallback ou configurar Resend já?).
2. **Resolver DV-1 (domínio):** comprar `axonai.com` (ou equivalente acordado) **antes** de iniciar o Sprint vercel_02.
3. **Confirmar acesso:** Edson tem conta Vercel ativa? Acesso ao GitHub repo? Cartão internacional pra comprar domínio?
4. Ao aprovar, disparar `@sprint-creator` para **Sprint vercel_01** — ele consome este plano + o PRD e produz `sprints/active/sprint_vercel_01_bootstrap_vercel_first_deploy.md` com checklist por agente, recomendação Opção 1/2, etc.
5. Rodar `Tech Lead, execute sprint_vercel_01_*` no sprint file gerado.

**Convenção de nomenclatura dos sprint files deste plano:** prefixo `sprint_vercel_NN_` para distinguir dos ciclos anteriores (`sprint_NN_` customer, `sprint_admin_NN_` admin produto). Padrão: `sprints/active/sprint_vercel_NN_[short-name].md`; ao encerrar migra para `sprints/done/sprint_vercel_NN_[short-name].md`.

---

## 7. Cobertura dos itens pendentes do plano admin

Este plano fecha as 3 pendências identificadas no veredito do plano admin (2026-04-29):

| Pendência (origem) | Coberto por | Status no fim do plano |
|---|---|---|
| 🟡 DNS/env vars de produção para origin isolation (Sprint admin_13 deixou pronto, não ativado) | Sprints vercel_01..vercel_04 | ✅ Ativo em produção |
| 🟢 G-16 (suíte E2E formal de fluxos golden) | Sprint vercel_05 | ✅ Suíte ativa, bloqueando merge |
| 🟢 G-17 (rollback de migration testado em staging) | Sprint vercel_06 | ✅ Staging operacional, protocolo @db-admin atualizado |

**Pendência adicional descoberta em 2026-04-29:**

| Pendência | Coberto por | Status no fim do plano |
|---|---|---|
| 🔴 `BREAK_GLASS_SECRET` hash não seedado em `platform_settings` (CLI break-glass quebra em incidente) | Sprint vercel_04 | ✅ Hash seedado, CLI operacional |

**Sprint admin_08 (Deep Inspect)** continua descartado por decisão de produto — não entra neste plano.
