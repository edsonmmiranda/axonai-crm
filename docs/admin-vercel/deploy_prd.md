# PRD — Deploy Produção Vercel (Axon AI CRM)

> **Status:** Draft para planejamento.
> **Owner:** Edson Miranda.
> **Data:** 2026-04-29.
> **Tipo:** Product Requirements Document — descreve **o quê** e **por quê**. Decisões de implementação ficam para o documento de planejamento ([`sprint_plan.md`](sprint_plan.md)).

---

## 1. Visão geral

Subir o Axon AI CRM em produção pública via **Vercel**, ativar a separação admin/customer entregue no Sprint admin_13 (origin isolation), validar que toda a pilha do MVP funciona em produção, e fechar as duas dívidas técnicas que ficaram em aberto no plano admin (`docs/admin_area/sprint_plan.md` §5):

- **G-16:** suíte de regressão de fluxos críticos (E2E formal — Playwright).
- **G-17:** migrations reversíveis com script de rollback testado em ambiente staging.

A área admin foi construída em 13 sprints (12 entregues, Sprint 08 descartado), mas hoje **só roda em local** (`localhost:3000`). Nenhum deploy público existe ainda.

---

## 2. Problema

Toda a stack do produto está pronta:

- ✅ Banco em produção (Supabase) com schema admin_01..admin_13 aplicado
- ✅ Edson seedado como platform admin owner ativo
- ✅ pg_cron rodando job horário de transições de subscription
- ✅ 318 testes de integração passando

Mas:

- ❌ App nunca foi deployado — só roda em `localhost:3000`
- ❌ Sem domínio próprio
- ❌ Origin isolation entregue mas inativo (env vars `NEXT_PUBLIC_ADMIN_HOST` / `NEXT_PUBLIC_CUSTOMER_HOST` não setadas)
- ❌ Sem validação ponta-a-ponta de que tudo funciona em produção real (HTTPS, cookies cross-origin, Supabase auth flows reais)
- ❌ Sem suíte E2E pra garantir que mudanças futuras não quebrem fluxos críticos
- ❌ Sem ambiente staging para testar rollback de migrations

**Implicação prática:** o produto não está usável pelos usuários finais. A equipe Axon não pode operar nada via UI admin. Clientes não têm como logar no CRM.

---

## 3. Personas

### 3.1. Operador de deploy (Edson)
- Faz o setup inicial no Vercel + DNS.
- Configura env vars de produção.
- Valida smoke tests em produção.
- Decide rollback se algo quebrar.

### 3.2. Platform admin (Edson + futuros operadores Axon)
- Beneficiário direto: passa a ter URL pública (`admin.axonai.com`) protegida por hostname gate.
- Pode operar a área admin a partir de qualquer lugar com browser.

### 3.3. Customer user (clientes)
- Beneficiário direto: passa a ter URL pública (`app.axonai.com`) com HTTPS, isolada da área admin.
- Não enxerga nem a existência de `/admin/*` quando acessa pelo customer host.

### 3.4. Atacante hipotético (anti-persona)
- Compromete sessão customer → origin isolation impede pivot pra admin (T-01).

---

## 4. Objetivos e métricas de sucesso

### 4.1. Objetivos do deploy

1. **App público funcional** — qualquer rota acessível via HTTPS num domínio estável.
2. **Origin isolation ativo** — `<customer-host>/admin/*` retorna 404; cookies isolados por domain.
3. **Pilha admin validada em prod** — login admin com MFA, audit log gravando, cron rodando, rate limit ativo.
4. **Suíte E2E ativa** — fluxos críticos validados automaticamente antes de cada merge na main (G-16).
5. **Staging operacional** — toda migration testada (apply + rollback + reapply) em staging antes de produção (G-17).

### 4.2. Métricas de sucesso

| Métrica | Target |
|---|---|
| Tempo do primeiro deploy ao app no ar | ≤ 1 hora (incluindo build + propagação DNS) |
| Smoke tests verdes em produção | 100% (login customer, login admin com MFA, criar org, suspender, audit log gravando) |
| Origin gate efetivo | `curl <customer-host>/admin/login` → 404; `curl <admin-host>/admin/login` → 200 |
| Cron rodando em produção | `cron.job_run_details` registra ≥1 execução por hora sem erro |
| Cobertura E2E (golden flows) | ≥7 cenários do PRD §7.8 G-16 cobertos e bloqueando merge |
| Rollback testado em staging | 100% das migrations futuras passam por (apply + rollback + reapply) antes de prod |

---

## 5. Escopo

### 5.1. Dentro do escopo

1. **Bootstrap Vercel** — conectar repo GitHub, configurar build, env vars básicas, primeiro deploy.
2. **Domínio próprio** — `axonai.com` (ou equivalente), DNS, SSL automático, `app.axonai.com` ativo.
3. **Ativação de origin isolation** — `admin.axonai.com`, env vars `NEXT_PUBLIC_ADMIN_HOST` e `NEXT_PUBLIC_CUSTOMER_HOST`, smoke tests do hostname gate.
4. **Validações em produção** — bateria de testes manuais cobrindo fluxos golden em ambiente real.
5. **Seed de pré-requisitos faltantes** — `BREAK_GLASS_SECRET` hash em `platform_settings` (necessário pra `scripts/break-glass.ts` funcionar — pendência identificada em 2026-04-29).
6. **Suíte E2E (G-16)** — Playwright instalado, ≥7 cenários golden cobertos, integrado ao GitHub Actions, bloqueia merge.
7. **Ambiente staging + rollback testado (G-17)** — projeto Supabase staging, Vercel preview env, protocolo do `@db-admin` adaptado.

### 5.2. Fora do escopo (fase 2+)

- **Custom domain de email transacional** (ex: `noreply@axonai.com` via SES/Resend) — Sprint 10 entregou fallback offline + bootstrap via SMTP env vars. Email "bonito" fica para depois.
- **CDN dedicado / cache de assets** — Vercel já tem edge network. Otimizações finas ficam para quando houver dataset grande.
- **Monitoring / observability stack** (Datadog, Sentry, Grafana) — logs nativos do Vercel cobrem o MVP.
- **Multi-region deploy** — `gru1` (São Paulo) basta. Globalização vira fase 2.
- **Disaster recovery formal** (backup off-site, RTO/RPO) — Supabase Pro tem PITR; suficiente para MVP.
- **Vercel Pro plan** — Hobby cobre o MVP. Upgrade quando bater limites.
- **Pipeline CI/CD complexo** — Vercel deployment automático via push pra main + preview por PR é suficiente.

---

## 6. Requisitos funcionais

### 6.1. Deploy

- **RF-DEP-1:** App deve rodar em produção pública via Vercel, build automático a cada push na branch `main`.
- **RF-DEP-2:** PRs abertos no GitHub geram preview deploys automáticos com URL única.
- **RF-DEP-3:** Variáveis de ambiente sensíveis configuradas no painel Vercel (não no repo) — separadas por escopo (Production / Preview / Development).
- **RF-DEP-4:** Build falha rápido se env var obrigatória ausente (mensagem clara apontando o que falta).

### 6.2. Domínio

- **RF-DOM-1:** Domínio `axonai.com` (ou equivalente) registrado e apontado para Vercel.
- **RF-DOM-2:** SSL/HTTPS ativo automaticamente (Let's Encrypt via Vercel).
- **RF-DOM-3:** `app.axonai.com` serve o customer app. Acesso via http é redirecionado para https.
- **RF-DOM-4:** `admin.axonai.com` serve a área admin. Acesso via http é redirecionado para https.
- **RF-DOM-5:** URLs do Supabase Auth (allowed redirect URLs) atualizadas para incluir os hosts de produção.

### 6.3. Origin isolation (ativação)

- **RF-ISO-1:** Acesso a `https://app.axonai.com/admin/*` retorna 404.
- **RF-ISO-2:** Acesso a `https://admin.axonai.com/<não-admin>` retorna 404.
- **RF-ISO-3:** Cookie de sessão admin tem `Domain=admin.axonai.com` + `SameSite=Strict` + `Secure`.
- **RF-ISO-4:** Cookie de sessão customer tem `Domain=app.axonai.com` + `SameSite=Strict` + `Secure`.
- **RF-ISO-5:** Sessão admin não é enviada em requests para customer host (validável via DevTools Network).

### 6.4. Validação em produção

- **RF-VAL-1:** Customer consegue fazer signup, confirmar email, e logar.
- **RF-VAL-2:** Platform admin consegue logar, fazer MFA enroll, acessar dashboard.
- **RF-VAL-3:** Customer pode criar leads, products, funnels — operações persistem.
- **RF-VAL-4:** Admin pode criar org cliente, suspender, reativar, trocar plano — operações geram audit row.
- **RF-VAL-5:** pg_cron job `admin_transition_subscriptions_hourly` está agendado e rodando em produção (verificável via `cron.job_run_details`).
- **RF-VAL-6:** Rate limit em login admin funciona (6+ tentativas falhas → 429 + audit row).
- **RF-VAL-7:** Convite de admin novo gera link copiável offline (ou envia email se SMTP configurado).
- **RF-VAL-8:** `BREAK_GLASS_SECRET` hash seedado em `platform_settings` (CLI `scripts/break-glass.ts` operacional).

### 6.5. E2E (G-16)

- **RF-E2E-1:** Playwright instalado e rodando localmente via `npm run test:e2e`.
- **RF-E2E-2:** ≥7 cenários golden cobertos: login customer, login admin com MFA, signup customer, onboarding org cliente (admin), suspensão de org, troca de plano, CRUD platform admin (convite + accept).
- **RF-E2E-3:** GitHub Actions roda E2E contra preview deploy a cada PR; merge bloqueado se qualquer cenário falhar.
- **RF-E2E-4:** Tempo de execução total ≤10 minutos (paralelizado).

### 6.6. Staging (G-17)

- **RF-STG-1:** Projeto Supabase staging existe (cópia separada de produção).
- **RF-STG-2:** Vercel project staging deploya automaticamente da branch `staging` com env vars apontando para Supabase staging.
- **RF-STG-3:** Protocolo do `@db-admin` (em `agents/ops/db-admin.md`) adaptado para exigir: `apply em staging → rollback em staging → reapply em staging → confirmar estado idêntico → só então apply em prod`.
- **RF-STG-4:** Runbook documentado em `docs/admin-vercel/runbook_staging_rollback.md`.

---

## 7. Requisitos não-funcionais

### 7.1. Segurança

- **RNF-DSEC-1:** Nenhuma env var sensível (SUPABASE_SERVICE_ROLE_KEY, BREAK_GLASS_SECRET, BOOTSTRAP_EMAIL_*) exposta como `NEXT_PUBLIC_*`.
- **RNF-DSEC-2:** Env vars de Production diferentes das de Preview (preview não tem service role com escopo de prod).
- **RNF-DSEC-3:** SSL obrigatório em produção; redirect 301 de http→https.
- **RNF-DSEC-4:** Allowed redirect URLs no Supabase Auth restritas a `app.axonai.com` e `admin.axonai.com` (sem wildcards).

### 7.2. Performance

- **RNF-DPER-1:** Region Vercel: `gru1` (São Paulo) para minimizar latência ao Supabase (também SP).
- **RNF-DPER-2:** First contentful paint ≤2s em produção (smoke test).

### 7.3. Disponibilidade

- **RNF-DAVA-1:** Deploy não pode tirar app do ar — Vercel faz blue-green automaticamente.
- **RNF-DAVA-2:** Rollback de deploy ≤2min via "Promote previous deployment" no painel Vercel.

### 7.4. Custo

- **RNF-DCST-1:** Vercel Hobby plan (free) suficiente para MVP. Limites: 100GB bandwidth/mês, 1 build em paralelo.
- **RNF-DCST-2:** Supabase Free tier ainda ativo (vai dar upgrade para Pro quando justificar — não bloqueia o deploy).
- **RNF-DCST-3:** Custo do domínio: ~R$50/ano para `.com` (Registro.br) ou ~$12/ano (Namecheap).

---

## 8. Restrições e premissas

### 8.1. Restrições

- **C-D1:** Vercel + Next.js — stack fixa (combinação testada).
- **C-D2:** Supabase já em produção — não migrar de hosting de banco no escopo deste plano.
- **C-D3:** Single-region (`gru1`) — multi-region é fase 2.
- **C-D4:** Sem orçamento para Vercel Pro inicialmente; Hobby suficiente.

### 8.2. Premissas

- **A-D1:** Edson tem ou consegue conta Vercel + acesso ao GitHub repo do projeto.
- **A-D2:** Edson consegue comprar `axonai.com` (ou equivalente) sem bloqueio (cartão internacional ou Registro.br).
- **A-D3:** DNS provider permite criar registros CNAME / A apontando para Vercel.
- **A-D4:** Supabase project atual continua sendo usado em produção (não cria projeto novo).

---

## 9. Decisões já tomadas

1. **Hosting:** Vercel — não vai mudar.
2. **Domínio:** `axonai.com` (ou variação acordada) com subdomínios `app.` e `admin.`.
3. **Region Vercel:** `gru1` (São Paulo).
4. **Plano Vercel:** Hobby para MVP.
5. **Supabase project:** o atual (não criar novo para produção; staging será separado em Sprint vercel_06).
6. **Branch model:** `main` = production deploy; PRs = preview deploys; `staging` (futura) = staging deploy.
7. **E2E framework:** Playwright (não Cypress) — TypeScript-native, headless padrão, suporte first-class no GitHub Actions.

---

## 10. Decisões em aberto (planejamento resolve)

1. **Domínio exato a usar** — `axonai.com`? Outro? Plano assume `axonai.com` mas é trocável.
2. **SMTP de produção** — usar fallback offline indefinidamente, configurar SMTP via Resend/SES, ou outra opção? Sprint 10 deixou flexível.
3. **Branch policy detalhada** — main protegida com PR obrigatório? Code review 1+ aprovação? Quando o time crescer.
4. **Staging deploy timing** — staging deploya a cada commit em `staging` (continuous) ou só sob demanda (manual)?

---

## 11. Riscos conhecidos

| Risco | Impacto | Mitigação |
|---|---|---|
| pg_cron desligado depois de migration futura | Médio | Sprint vercel_04 valida e adiciona ao smoke test; documentar no runbook |
| Build falha no Vercel por env var faltante | Baixo | Build local já confere via `getEnv()` que joga erro claro; adicionar checklist no runbook de deploy |
| Cookie `domain` setado errado quebra login em produção | Alto | Sprint vercel_03 tem smoke test específico (DevTools); rollback via remover env vars + redeploy (≤2min) |
| Allowed redirect URLs do Supabase desatualizadas | Médio | Sprint vercel_02 inclui essa atualização no checklist |
| `BREAK_GLASS_SECRET` hash não seedado, CLI quebra em incidente | Alto | Sprint vercel_04 inclui o seed como item bloqueante |
| Domínio comprado mas DNS não propaga em tempo razoável | Baixo | Aceitar até 24h em casos extremos; Vercel mostra status |
| E2E Playwright instável no CI | Médio | Cenários focados em estado pré-determinado, retry estratégico (Playwright tem built-in) |
| Staging Supabase exige Pro plan | Médio | Validar no Sprint vercel_06 — alternativa: usar branching do Supabase (preview branches) |

---

## 12. Glossário

- **Vercel:** plataforma de deploy serverless para apps Next.js/React, com integração direta ao GitHub.
- **Region `gru1`:** região Vercel em São Paulo (latência baixa para Supabase também em SP).
- **Edge network:** CDN nativo do Vercel para assets estáticos.
- **Preview deploy:** URL única gerada automaticamente por PR, isolada de produção.
- **Hobby plan:** plano gratuito do Vercel com limites suficientes para MVP.
- **Origin isolation:** mecanismo de segurança que serve admin e customer em hostnames distintos (entregue no Sprint admin_13, ativado neste plano).
- **Hostname gate:** middleware que aplica origin isolation (`src/lib/middleware/hostnameGate.ts`).
- **Staging:** ambiente cópia de produção usado para testes (DB + app), separado em Sprint vercel_06.
- **Playwright:** ferramenta de E2E testing — robô que controla browser real (Chromium/Firefox/Webkit).

---

## 13. O que este PRD NÃO contém (intencionalmente)

- Decisões de implementação (qual região exata, quais env vars no nome final, configuração de cache).
- Quebra em sprints — isso vive em [`sprint_plan.md`](sprint_plan.md).
- Detalhes de runbook operacional — esses ficam em `docs/admin_area/runbook_*.md` (origin isolation já existe) e novos em `docs/admin-vercel/runbook_*.md` quando criados nos sprints.
- Custo detalhado / análise de upgrade Vercel Pro — feature de fase 2 quando o limite Hobby for batido.

Tudo isso é responsabilidade do [`sprint_plan.md`](sprint_plan.md) e dos sprint files individuais.
