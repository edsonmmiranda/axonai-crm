# Roadmap — Alinhar o sistema ao banco existente

**Última atualização:** 2026-04-15
**Status do banco:** 15 tabelas em `public` (multi-tenant por `organization_id`). Snapshot em [`schema_snapshot.json`](./schema_snapshot.json).
**Status do app:** bootstrap + dashboard mockado. Zero auth, zero módulo de negócio real.

Este documento é o **plano executivo** para levar o app de "dashboard mockado" até "CRM funcional cobrindo 100% das tabelas existentes". Cada linha da tabela vira uma sprint (`sprints/active/sprint_XX_*.md`) criada pelo `@sprint-creator` e executada via Workflow A do Tech Lead.

---

## 🔭 Visão geral

```
Sprint 03 → Auth & Tenancy          ← bloqueia tudo - Feito
Sprint 04 → Profile & Org Settings  ← fecha auth - Feito
Sprint 05 → Categories (catálogo)   ← warm-up CRUD
Sprint 06 → Products + Storage      ← upload + galeria
Sprint 07 → Lead Origins · Loss Reasons · Tags (settings)
Sprint 08 → Leads — Lista (table)   ← core do produto
Sprint 09 → Funnels & Stages
Sprint 10 → Pipeline — Kanban DnD
Sprint 11 → Dashboard real          ← substitui mocks
Sprint 12 → WhatsApp Groups (CRUD)
Sprint 13 → WhatsApp Integração (externo)
```

Sprint	Modelo	Por quê
05 — Categories	Sonnet 4.6	CRUD mínimo (8 colunas), é o warm-up. Padrão vai ser replicado — vale investir um pouco para deixar o template limpo, mas não precisa de Opus.
06 — Products + Storage	Opus 4.6	20 colunas + 2 tabelas auxiliares + Storage (buckets, is_primary, position, reorder). Primeira vez tocando Storage → decisões que vão virar padrão.
07 — Lead Origins / Loss / Tags	Sonnet 4.6 (ou Haiku se optar por 3 LIGHT)	3 CRUDs curtos seguindo template do Sprint 05/06. Mecânico.
08 — Leads Lista	Opus 4.6	27 colunas, tabs, filtros server-side, paginação, lead_tags M2M, UTM, export. Core do produto — erros aqui custam caro.
09 — Funnels & Stages	Sonnet 4.6	CRUD + reordenação de linhas. Padrão conhecido.
10 — Pipeline Kanban DnD	Opus 4.6	DnD com @dnd-kit, bulk update atômico de card_order, transação, modal condicional de perda. Performance + correção.
11 — Dashboard real	Opus 4.6 para a decisão arquitetural (manter/cortar tasks e sales_goals) → Sonnet 4.6 para executar as queries depois de decidido	Decisão de escopo é o valor; queries em si são diretas.
12 — WhatsApp Groups CRUD	Sonnet 4.6	CRUD simples + FK pra lead_origins.
13 — WhatsApp Integração	Opus 4.6 (fase 1 research + fase 2 webhook/migration)	Escolha de provider, webhook seguro, nova tabela com RLS, matching por telefone. Alto impacto e ambíguo.
Regra geral para este roadmap: Opus nos sprints 06, 08, 10, 13 (e na fase de decisão do 11); Sonnet no resto. Se um sprint Sonnet travar em decisão não-óbvia, escalar para Opus na hora em vez de forçar.



**Critério de "100% alinhado":** toda tabela do snapshot tem um módulo CRUD acessível no app, com RLS validada, Server Actions tipadas, formulário com Zod, e telas com tokens semânticos aprovadas pelo Guardian.

---

## 🚦 Pré-sprint (obrigatório antes de qualquer codificação)

Todo sprint começa com o Tech Lead rodando esta checklist. Se qualquer item falhar, PARA e reporta.

1. **Git limpo** — `git status --porcelain` vazio.
2. **Credenciais válidas** — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` presentes e não-vazias em `.env.local`.
3. **Snapshot fresco** — `node scripts/introspect-schema.mjs` re-executado se houve DDL externo desde a última leitura.
4. **Leituras de boot** (Tech Lead) — `docs/conventions/standards.md` · `docs/schema_snapshot.json` · `docs/APRENDIZADOS.md`.
5. **Se o sprint envolve migration** — `@db-admin` roda introspecção ao vivo (não confia em arquivo) antes de escrever SQL.

---

## 📋 Sprint 03 — Auth & Tenancy

**Objetivo:** usuário consegue logar, sessão persiste, toda rota sob `(app)/` exige auth, Server Actions têm `organization_id` disponível via contexto.

**Inputs do banco:** `organizations`, `profiles`, `auth.users` (schema `auth`).

**Trabalho:**
- **DB probe** (`@db-admin`): confirmar triggers de auto-provisionamento. Listar triggers via novo RPC ou consulta direta — especialmente `on_auth_user_created` que liga `auth.users` → `profiles`. Decidir: já existe? Precisa ajustar? Documentar em APRENDIZADOS se houver surpresa.
- **Rotas novas:**
  - `src/app/(auth)/login/page.tsx` — email + password (Supabase Auth)
  - `src/app/(auth)/signup/page.tsx` — email + password + nome + slug da org (ou aceite de convite via token na query string)
  - `src/app/(auth)/accept-invite/[token]/page.tsx` — fluxo de convite
  - `src/app/auth/callback/route.ts` — OAuth/magic-link handler (se usarmos)
- **Middleware** — o `middleware.ts` atual só faz refresh. Estender pra redirecionar `(app)/*` → `/login` quando `session` é null.
- **Context helper** — `src/lib/supabase/getSessionContext.ts` (Server): retorna `{ userId, organizationId, role }` lendo `profiles` do usuário autenticado. Usado em toda Server Action.
- **Layout `(app)`** — passar a puxar nome/avatar real pro Topbar via `getSessionContext()`.

**Gates:** 1 (DB validação), 2 (build+lint), 4 (Guardian), 5 (verify-design).

**Aceite:**
- Logar com usuário já existente no `auth.users` funciona.
- Signup cria `auth.users` + `profiles` + (se primeiro user) `organizations`.
- Aceitar convite com token expirado retorna erro legível.
- Acessar `/dashboard` sem sessão redireciona pra `/login`.
- Todo Server Action futuro pode chamar `getSessionContext()` e receber org_id válido.

---

## 📋 Sprint 04 — Profile & Org Settings

**Tabelas:** `profiles`, `organizations`, `invitations`.

**Trabalho:**
- `/settings/profile` — nome, avatar (upload pra Storage), telefone, preferences.
- `/settings/organization` — só admin/owner. Nome, slug, plan (read-only por ora), max_users, settings jsonb.
- `/settings/team` — lista `profiles` da org + lista `invitations` pendentes. Ações: criar convite, revogar, reenviar.
- Email de convite: **decidir provider** (Resend? Supabase Auth native? link manual?). Se externo → sprint vira STANDARD com `@api-integrator`.

**Aceite:** admin consegue convidar, user aceitar via link, user atualizar próprio profile.

---

## 📋 Sprint 05 — Categories

**Tabela:** `categories` (8 colunas, já tem RLS).

**Trabalho:** CRUD completo em `/settings/catalog/categories`. Form simples (name, slug auto-gerado, description, active). Lista com busca.

**Aceite:** CRUD funciona, RLS bloqueia categoria de outra org.

---

## 📋 Sprint 06 — Products + Storage

**Tabelas:** `products`, `product_images`, `product_documents`, `categories` (FK).

**Trabalho:**
- `/products` lista com busca, filtro por categoria, paginação.
- `/products/new` e `/products/[id]` — form completo (20 colunas: SKU, preço, estoque, dimensões, marca, tags array, category_id, notes).
- Upload de imagens e documentos pra Supabase Storage → gravar url em `product_images`/`product_documents`.
- Galeria com `is_primary`, reordenação por `position`.

**Aceite:** criar produto com 3 imagens, marcar uma como primary, editar, deletar imagem sem apagar produto.

**⚠️ Configuração externa:** buckets Storage precisam existir (`products`, `documents`). Confirmar com `@db-admin` antes.

---

## 📋 Sprint 07 — Settings de Lead (Origins · Loss Reasons · Tags)

**Tabelas:** `lead_origins`, `loss_reasons`, `tags`.

**Trabalho:** 3 CRUDs curtos em `/settings/leads/*`. Pode ser 1 sprint STANDARD ou 3 LIGHT — Tech Lead decide.

**Aceite:** admin consegue criar origens (type, platform), motivos de perda, e tags coloridas.

---

## 📋 Sprint 08 — Leads (Lista / Table view)

**Tabelas:** `leads` (27 colunas), `lead_tags`, `lead_origins`, `loss_reasons`, `profiles` (assigned_to, created_by), `tags`.

**Trabalho:**
- `/leads` tabela com colunas: nome, email, telefone, origem, status, score, value, assigned_to, created_at.
- Filtros: status, origin_id, assigned_to, tag, busca por texto (nome/email/company).
- Paginação server-side.
- `/leads/new` e `/leads/[id]` — form com todos os 27 campos distribuídos em tabs (Dados · UTM · Comercial · Notas).
- Atribuir tags via multi-select (grava em `lead_tags`).
- Marcar perda: seta `status='lost'` + `loss_reason_id` + `loss_notes`.

**Aceite:** criar lead com UTM completo, mudar status, atribuir a outro user, filtrar, exportar CSV (opcional).

---

## 📋 Sprint 09 — Funnels & Stages

**Tabelas:** `funnels`, `funnel_stages`.

**Trabalho:** `/settings/pipeline` — admin cria funis, adiciona/reordena estágios (drag de linhas). Toggle is_active.

**Aceite:** admin configura 1 funil com 5 estágios, ativa, desativa outro.

---

## 📋 Sprint 10 — Pipeline (Kanban com DnD)

**Tabelas:** `leads.stage_id`, `leads.card_order`, `funnel_stages`, `funnels`.

**Trabalho:**
- `/pipeline` — seletor de funil + board Kanban com colunas = estágios.
- Cards de lead mostram nome, value, tags, assigned_to avatar.
- Drag-and-drop entre colunas (`@dnd-kit/sortable`): atualiza `stage_id` + `card_order`.
- Drag dentro da mesma coluna: atualiza `card_order` (atomic bulk update).
- Drop em coluna "Perdido" → abre modal com `loss_reason_id` + `loss_notes` obrigatórios.

**Aceite:** arrastar 5 leads entre estágios persiste, ordem é respeitada após reload, perda sem motivo é bloqueada.

**⚠️ Performance:** reordenação em lote precisa ser 1 Server Action com transação. Confirmar padrão com `@backend`.

---

## 📋 Sprint 11 — Dashboard real

**Trabalho:** substituir `src/lib/mocks/dashboard.ts` por queries reais:
- KPIs: COUNT leads por status do mês + comparação com mês anterior.
- Leads recentes: últimos 5 por `created_at`.
- Pipeline card: contagem + soma de `value` por estágio.
- Sales goal / monthly goal: **precisa de tabela nova** (ainda não existe). Decidir: criar `sales_goals` agora ou deixar mockado até Sprint 13+?
- Upcoming tasks: **precisa de tabela `tasks`** que ainda não existe.

**Decisão arquitetural pendente:** criar `tasks` + `sales_goals` como parte deste sprint ou adiar. Recomendo **adiar os mocks de meta/tarefa** — remover os cards até ter a tabela.

---

## 📋 Sprint 12 — WhatsApp Groups (CRUD)

**Tabela:** `whatsapp_groups`.

**Trabalho:** `/settings/whatsapp/groups` — CRUD + vinculação de grupos a origens (lead_origin).

**Aceite:** criar grupo, editar, desativar, listar.

---

## 📋 Sprint 13 — WhatsApp Integração (real)

**Fase 1 (research do `@api-integrator`):** avaliar Evolution API vs Z-API vs WhatsApp Cloud API oficial. Definir provider. Gera `docs/api_research/whatsapp_research.md`.

**Fase 2:** webhook de mensagens, ingestão, nova tabela `whatsapp_messages` (migration do `@db-admin`), vincular mensagem a lead por telefone, página `/whatsapp/inbox`.

**⚠️ Sprint grande.** Possivelmente quebrar em 13a (research + groups mapping) e 13b (inbox + linking).

---

## 🕳️ Tabelas/features que **faltam** no banco atual

Descobertas pelo mock do dashboard que ainda não têm schema:

| Entidade | Onde aparece | Quando criar |
|---|---|---|
| `tasks` | `UpcomingTasksCard` | Sprint 11 (se decidirmos manter) ou sprint dedicada |
| `sales_goals` / `monthly_goals` | `GoalsRow` | Sprint 11 ou dedicada |
| `whatsapp_messages` | não mockado | Sprint 13b |
| `lead_activities` / `lead_notes` | timeline de lead | provável Sprint 8 ou pós-MVP |
| `audit_log` | auditoria de quem mudou o quê | pós-MVP |

Cada uma exige: migration idempotente do `@db-admin` + RLS por `organization_id` + atualização do snapshot.

---

## ♻️ Depois de cada sprint

Tech Lead, no closing:
1. Re-roda `node scripts/introspect-schema.mjs` se a sprint mexeu em schema.
2. Registra em `docs/APRENDIZADOS.md` apenas se algo não-óbvio apareceu.
3. Invoca `@git-master` pra commit + push.
4. Marca a linha correspondente aqui (checkbox ou tachado).

---

## ⏱️ Estimativa grosseira

Assumindo 1 sprint ≈ 1 sessão de trabalho (+/- 2–4h de execução humana de revisão):

- Sprints 03–04 (auth): **2 sessões** · desbloqueia tudo
- Sprints 05–07 (catálogo + settings de lead): **3 sessões** · CRUDs simples
- Sprints 08–10 (core CRM): **3 sessões** · o coração
- Sprint 11 (dashboard): **1 sessão**
- Sprints 12–13 (WhatsApp): **2–3 sessões** · depende do provider

**Total:** ~11–13 sessões pra cobertura 100% das tabelas existentes + integração WhatsApp viva.
