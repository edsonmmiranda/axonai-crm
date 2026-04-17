# Roadmap — Alinhar o sistema ao banco existente

**Última atualização:** 2026-04-17
**Status do banco:** 15 tabelas em `public` (multi-tenant por `organization_id`). Snapshot em [`schema_snapshot.json`](./schema_snapshot.json).
**Status do app:** bootstrap + dashboard mockado. Zero auth, zero módulo de negócio real.

Este documento é o **plano executivo** para levar o app de "dashboard mockado" até "CRM funcional cobrindo 100% das tabelas existentes". Cada linha da tabela vira uma sprint (`sprints/active/sprint_XX_*.md`) criada pelo `@sprint-creator` e executada via Workflow A do Tech Lead.

---

## 🔭 Visão geral

```
Sprint 03 → Auth & Tenancy          ← bloqueia tudo - Feito
Sprint 04 → Profile & Org Settings  ← fecha auth - Feito
Sprint 05 → Categories (catálogo)   ← warm-up CRUD - Feito
Sprint 06 → Products + Storage      ← upload + galeria - Feito
Sprint 07 → Lead Origins (menu Leads > Origens)
Sprint 08 → Loss Reasons (menu Leads > Motivos de Perda)
Sprint 09 → Tags (menu Leads > Tags)
Sprint 10 → Leads — Lista (menu Leads > Todos os Leads) ← core do produto
Sprint 11 → Funnels
Sprint 12 → Funnel Stages
Sprint 13 → Pipeline — Kanban DnD
Sprint 14 → Dashboard real          ← substitui mocks
Sprint 15 → WhatsApp Groups (CRUD)
Sprint 16 → WhatsApp Research (provider + mapping)
Sprint 17 → WhatsApp Inbox (webhook + messages)
```

Sprint	Modelo	Por quê
05 — Categories	Sonnet 4.6	CRUD mínimo (8 colunas), é o warm-up. Padrão vai ser replicado — vale investir um pouco para deixar o template limpo, mas não precisa de Opus.
06 — Products + Storage	Opus 4.6	20 colunas + 2 tabelas auxiliares + Storage (buckets, is_primary, position, reorder). Primeira vez tocando Storage → decisões que vão virar padrão.
07 — Lead Origins	Haiku 4.5	CRUD curto (type, platform). Mecânico, padrão já definido no 05.
08 — Loss Reasons	Haiku 4.5	CRUD curto. Mecânico.
09 — Tags	Haiku 4.5 / Sonnet 4.6	CRUD curto + color picker. Quase mecânico.
10 — Leads Lista	Opus 4.6	27 colunas, tabs, filtros server-side, paginação, lead_tags M2M, UTM, export. Core do produto — erros aqui custam caro.
11 — Funnels	Sonnet 4.6	CRUD simples, toggle is_active.
12 — Funnel Stages	Sonnet 4.6	CRUD + reordenação de linhas (drag). Padrão conhecido.
13 — Pipeline Kanban DnD	Opus 4.6	DnD com @dnd-kit, bulk update atômico de card_order, transação, modal condicional de perda. Performance + correção.
14 — Dashboard real	Opus 4.6 para a decisão arquitetural (manter/cortar tasks e sales_goals) → Sonnet 4.6 para executar as queries depois de decidido	Decisão de escopo é o valor; queries em si são diretas.
15 — WhatsApp Groups CRUD	Sonnet 4.6	CRUD simples + FK pra lead_origins.
16 — WhatsApp Research	Opus 4.6	Escolha de provider (Evolution / Z-API / Cloud API), mapeamento de grupos → origens. Ambíguo, alta alavancagem.
17 — WhatsApp Inbox	Opus 4.6	Webhook seguro, nova tabela com RLS, matching por telefone, página /whatsapp/inbox. Alto impacto.

Regra geral para este roadmap: Opus nos sprints 06, 10, 13, 16, 17 (e na fase de decisão do 14); Sonnet/Haiku no resto. Se um sprint Sonnet/Haiku travar em decisão não-óbvia, escalar para Opus na hora em vez de forçar.



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

## 📋 Sprint 07 — Lead Origins

**Tabela:** `lead_origins`.

**Menu:** Leads > Origens

**Trabalho:** CRUD curto em `/leads/origins`. Form com name, type, platform, active. Criar o menu lateral "Leads" com submenus: Todos os Leads, Origens, Tags, Motivos de Perda. Neste sprint, apenas "Origens" estará funcional — os demais links ficam visíveis mas apontam para páginas placeholder.

**Aceite:** admin consegue criar/editar/desativar origens; RLS bloqueia origem de outra org; menu Leads aparece no sidebar com os 4 submenus.

---

## 📋 Sprint 08 — Loss Reasons

**Tabela:** `loss_reasons`.

**Menu:** Leads > Motivos de Perda

**Trabalho:** CRUD curto em `/leads/loss-reasons`. Form com name, description, active.

**Telas Modelo**
- Lista - Baseada em design_system/telas_protas/leads_lista.html
- Inclusão  - Baseada em design_system/telas_protas/leads_criar.html
- Alteralção - Baseada em design_system/telas_protas/leads_editar.html

**Aceite:** admin consegue criar/editar/desativar motivos de perda; lista mostra apenas os da org.

---

## 📋 Sprint 09 — Tags

**Tabela:** `tags`.

**Menu:** Leads > Tags

**Trabalho:** CRUD curto em `/leads/tags`. Form com name, color (picker), active. Preview visual no listing.

**Aceite:** admin cria tag colorida, edita cor, desativa; pronto para consumo pelo módulo de Leads (lead_tags M2M).

---

## 📋 Sprint 10 — Leads (Lista / Table view)

**Tabelas:** `leads` (27 colunas), `lead_tags`, `lead_origins`, `loss_reasons`, `profiles` (assigned_to, created_by), `tags`.

**Menu:** Leads > Todos os Leads

**Trabalho:**
- `/leads` (lista principal) tabela com colunas: nome, email, telefone, origem, status, score, value, assigned_to, created_at.
- Filtros: status, origin_id, assigned_to, tag, busca por texto (nome/email/company).
- Paginação server-side.
- `/leads/new` e `/leads/[id]` — form com todos os 27 campos distribuídos em tabs (Dados · UTM · Comercial · Notas).
- Atribuir tags via multi-select (grava em `lead_tags`).
- Marcar perda: seta `status='lost'` + `loss_reason_id` + `loss_notes`.

**Aceite:** criar lead com UTM completo, mudar status, atribuir a outro user, filtrar, exportar CSV (opcional).

**Pré-requisito:** Sprints 07–09 concluídos (origens, motivos de perda e tags já cadastráveis pelo admin).

---

## 📋 Sprint 11 — Funnels

**Tabela:** `funnels`.

**Trabalho:** `/settings/pipeline/funnels` — CRUD de funis. Form com name, description, is_active, is_default. Regra: só um funil default por org.

**Aceite:** admin cria funil, marca como default, desativa outro; default exclusivo é respeitado.

---

## 📋 Sprint 12 — Funnel Stages

**Tabela:** `funnel_stages` (FK → `funnels`).

**Trabalho:** dentro da tela do funil (`/settings/pipeline/funnels/[id]/stages`), CRUD + reordenação de linhas (drag). Campos: name, position, color, is_won, is_lost.

**Aceite:** admin adiciona 5 estágios, reordena, marca um como won e outro como lost; ordem persiste.

**Pré-requisito:** Sprint 11 concluído.

---

## 📋 Sprint 13 — Pipeline (Kanban com DnD)

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

## 📋 Sprint 14 — Dashboard real

**Trabalho:** substituir `src/lib/mocks/dashboard.ts` por queries reais:
- KPIs: COUNT leads por status do mês + comparação com mês anterior.
- Leads recentes: últimos 5 por `created_at`.
- Pipeline card: contagem + soma de `value` por estágio.
- Sales goal / monthly goal: **precisa de tabela nova** (ainda não existe). Decidir: criar `sales_goals` agora ou deixar mockado até sprint futura?
- Upcoming tasks: **precisa de tabela `tasks`** que ainda não existe.

**Decisão arquitetural pendente:** criar `tasks` + `sales_goals` como parte deste sprint ou adiar. Recomendo **adiar os mocks de meta/tarefa** — remover os cards até ter a tabela.

---

## 📋 Sprint 15 — WhatsApp Groups (CRUD)

**Tabela:** `whatsapp_groups`.

**Trabalho:** `/settings/whatsapp/groups` — CRUD + vinculação de grupos a origens (lead_origin).

**Aceite:** criar grupo, editar, desativar, listar.

---

## 📋 Sprint 16 — WhatsApp Research

**Fase única (research do `@api-integrator`):** avaliar Evolution API vs Z-API vs WhatsApp Cloud API oficial. Definir provider. Mapear fluxo de autenticação, limites, custo, webhook format. Entregável: `docs/api_research/whatsapp_research.md` com recomendação + spike de prova-de-conceito (conectar, listar grupos, receber 1 mensagem em ambiente de dev).

**Aceite:** decisão de provider documentada com trade-offs + POC funcional numa sandbox.

---

## 📋 Sprint 17 — WhatsApp Inbox

**Tabela nova:** `whatsapp_messages` (migration do `@db-admin`) com RLS por `organization_id`.

**Trabalho:**
- Webhook seguro (assinatura/HMAC conforme provider escolhido no Sprint 16).
- Ingestão de mensagens → `whatsapp_messages`.
- Matching por telefone contra `leads` (vincular `lead_id` quando houver match).
- Página `/whatsapp/inbox` — lista de conversas, filtros, abertura de thread.

**Pré-requisito:** Sprint 16 concluído (provider decidido + POC).

**Aceite:** mensagem recebida via webhook aparece no inbox em <5s, linkada ao lead correto quando o telefone bate.

---

## 🕳️ Tabelas/features que **faltam** no banco atual

Descobertas pelo mock do dashboard que ainda não têm schema:

| Entidade | Onde aparece | Quando criar |
|---|---|---|
| `tasks` | `UpcomingTasksCard` | Sprint 14 (se decidirmos manter) ou sprint dedicada |
| `sales_goals` / `monthly_goals` | `GoalsRow` | Sprint 14 ou dedicada |
| `whatsapp_messages` | não mockado | Sprint 17 |
| `lead_activities` / `lead_notes` | timeline de lead | provável Sprint 10 ou pós-MVP |
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

- Sprints 03–04 (auth): **2 sessões** · desbloqueia tudo ✅
- Sprint 05 (categorias): **1 sessão**
- Sprint 06 (products + storage): **1 sessão**
- Sprints 07–09 (settings de lead, 1 por CRUD): **3 sessões**
- Sprint 10 (leads lista): **1 sessão** · core
- Sprints 11–12 (funnels + stages): **2 sessões**
- Sprint 13 (pipeline kanban): **1 sessão**
- Sprint 14 (dashboard): **1 sessão**
- Sprint 15 (whatsapp groups): **1 sessão**
- Sprints 16–17 (whatsapp research + inbox): **2 sessões**

**Total:** ~15 sessões pra cobertura 100% das tabelas existentes + integração WhatsApp viva.
