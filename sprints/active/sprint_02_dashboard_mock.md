# Sprint 02: Dashboard Principal (Mock) (LIGHT)

> **Nível:** LIGHT
> **Quando usar:** bugfixes, ajustes de UI isolados, pequenas features que afetam um único módulo sem mudanças de schema, sem novo módulo CRUD, sem integração externa nova.
> **Quando NÃO usar:** se houver criação de novo CRUD, nova tabela, nova integração de API, ou mudança em múltiplos módulos → use `docs/templates/sprints/TEMPLATE_SPRINT_STANDARD.md`.

---

## 🎯 Objetivo de Negócio

Entregar a primeira tela real do CRM — o **Dashboard principal** — em fidelidade visual 1:1 com a referência estática em [`design_system/telas_prontas/dashboard.html`](../../design_system/telas_prontas/dashboard.html), usando **dados mockados**. O objetivo é validar o design system em contexto de aplicação real e estabelecer o `AppLayout` compartilhado (sidebar + topbar) que servirá como esqueleto das próximas telas do CRM.

**Não há lógica de negócio, persistência, autenticação ou integração nesta sprint** — é uma entrega puramente visual/estrutural. Dados reais entram em sprints futuras substituindo os mocks.

---

## 📋 Escopo (o que fazer)

### Referência visual (fonte da verdade)

- [`design_system/telas_prontas/dashboard.html`](../../design_system/telas_prontas/dashboard.html) — replique estrutura, tokens semânticos (`bg-surface-raised`, `text-text-primary`, `action-primary`, `feedback-*`, etc.), espaçamento, responsividade (`md:`, `lg:`) e ícones Lucide. **Proibido hex inline, cores arbitrárias Tailwind (`bg-[#...]`), ou `style={{}}` para cores** — respeitar [`docs/conventions/standards.md`](../../docs/conventions/standards.md) e guardrails do GATE 5.

### Arquivos afetados

**Dependência nova (package):**

- [ ] `package.json` — adicionar `lucide-react` (via `npm install lucide-react`). A referência HTML usa o CDN `unpkg.com/lucide`; na aplicação Next, usar o package npm.

**Layout compartilhado (novo):**

- [ ] `src/components/layout/AppLayout.tsx` — shell `flex h-screen` com `<Sidebar />` + coluna vertical (`<Topbar />` + `<main>{children}</main>`). Exporta default.
- [ ] `src/components/layout/Sidebar.tsx` — replica o `<aside>` da referência (linhas 148–212 do HTML): logo "SalesPro CRM", nav primária (Dashboard, Leads, Pipeline, WhatsApp com badge), seção "Relatórios" (Desempenho, Conversão), seção inferior (Configurações, Sair) e user card no rodapé. Usa `usePathname()` do `next/navigation` para marcar item ativo; por ora só `/dashboard` está implementado — demais itens são `<Link href="#">` inertes. Responsivo: `hidden md:flex` (mobile fica oculta nesta sprint — hamburger vem em sprint futura).
- [ ] `src/components/layout/Topbar.tsx` — replica o header da referência (linhas ~213–260): breadcrumb/título "Dashboard", busca global (input visual, sem submit), botão notificações, avatar user. Sem lógica — tudo placeholder visual.
- [ ] `src/app/(app)/layout.tsx` — Server Component que envolve `children` em `<AppLayout>`.

**Rotas:**

- [ ] `src/app/(app)/dashboard/page.tsx` — Server Component que importa os mocks e compõe os componentes privados da rota.
- [ ] `src/app/page.tsx` — substituir conteúdo atual por `redirect('/dashboard')` (do `next/navigation`). Dashboard passa a ser a home real.

**Componentes privados da rota** (em `src/app/(app)/dashboard/_components/`):

- [ ] `GreetingHeader.tsx` — "Bom dia, Roberto!" + data + 3 quick action buttons (Lead / Proposta / Nova Tarefa). Botões sem `onClick` — apenas visuais.
- [ ] `KpiCards.tsx` — grid responsivo `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`, recebe `kpis: KPI[]` por prop. Renderiza 4 cards (Novos Leads, Em Negociação, Contatos Realizados, WhatsApp) com ícone decorativo, valor, label e badge de tendência opcional.
- [ ] `RecentLeadsTable.tsx` — tabela com header ("Leads Recentes" + link "Ver todos"), colunas Nome (com avatar inicial colorido), Interesse, Origem (badge), Status (badge), Ação (botão `more-vertical` placeholder). Recebe `leads: Lead[]`.
- [ ] `GoalsRow.tsx` — agrupa **Meta de Vendas** (card com gradient `from-action-primary-hover to-action-primary-active`, título, pilha de avatares, CTA "Ver Detalhes") e **Metas do Mês** (card com progress bar, percentual, texto auxiliar). Recebe `salesGoal: SalesGoal` e `monthlyGoal: MonthlyGoal`.
- [ ] `PipelineCard.tsx` — "Pipeline de Vendas" com 4 barras de progresso (Prospecção, Demonstração, Proposta, Fechamento) cada uma usando uma cor semântica diferente (`feedback-info`, `feedback-warning`, `feedback-accent`, `feedback-success`). Recebe `stages: PipelineStage[]`.
- [ ] `UpcomingTasksCard.tsx` — "Próximas Tarefas" com lista de itens (bolinha colorida de prioridade + título + horário) e CTA "Ver Todas as Tarefas" no rodapé. Recebe `tasks: Task[]`.

**Mocks + tipos:**

- [ ] `src/lib/mocks/dashboard.ts` — define e exporta os tipos e instâncias mockadas:
  - Tipos: `KPI`, `Lead`, `LeadSource`, `LeadStatus`, `SalesGoal`, `MonthlyGoal`, `PipelineStage`, `Task`, `TaskPriority`.
  - Dados: `mockKpis`, `mockRecentLeads` (4 linhas, mesmas da referência: Ana Maria, Carlos Souza, Mariana Jones, Paulo Ricardo), `mockSalesGoal`, `mockMonthlyGoal`, `mockPipelineStages` (4 estágios), `mockUpcomingTasks` (3 tarefas).
  - **Não usar `any`.** Tipos devem já antecipar o shape esperado das futuras Server Actions (ex.: `Lead.source: 'whatsapp' | 'website' | 'indicacao'`).

### Comportamento esperado

- Acessar `/` redireciona para `/dashboard`.
- `/dashboard` renderiza a tela fiel à referência HTML, com sidebar à esquerda, topbar no topo, e o conteúdo principal exatamente como no mock.
- Sidebar: item "Dashboard" visualmente ativo (`bg-action-primary/10`, `text-action-primary`). Demais itens inertes (`href="#"`).
- Todos os ícones vêm de `lucide-react` (não CDN). Ícones usados: `building-2`, `layout-dashboard`, `users`, `kanban`, `message-circle`, `bar-chart-3`, `trending-up`, `trending-down`, `settings`, `log-out`, `search`, `bell`, `user-plus`, `file-text`, `circle-check`, `dollar-sign`, `phone`, `globe`, `more-vertical`, `arrow-right`, `rocket`, `flag`, `clock`, `plus`.
- Responsividade: sidebar oculta abaixo de `md`, grid de KPIs colapsa em 2 colunas no `sm` e 1 no mobile, main grid 2/3 + 1/3 colapsa em coluna única abaixo de `lg`.
- **Sem `onClick`, sem state, sem fetch, sem Server Actions** nos componentes — todos são puramente apresentacionais.

---

## 🚫 Fora de escopo

- ❌ Nenhuma nova tabela no Supabase, nenhuma migration, nenhum acesso ao banco.
- ❌ Nenhuma Server Action. Nenhum arquivo em `src/lib/actions/`.
- ❌ Autenticação / proteção de rota — `/dashboard` fica público por enquanto (sprint futura adiciona middleware).
- ❌ Funcionalidade real de quick actions, busca, notificações, user menu, menu `more-vertical` da tabela, botões "Ver todos / Ver Detalhes / Ver Todas as Tarefas" — todos permanecem placeholders visuais.
- ❌ Responsividade mobile da sidebar (hamburger menu, drawer) — sidebar fica `hidden md:flex` nesta sprint.
- ❌ Dark mode / theme toggle.
- ❌ Internacionalização — copy pode ficar em pt-BR hardcoded como no mock.
- ❌ Testes automatizados (vitest, playwright) — não há suíte no projeto.
- ❌ Gráficos reais (Recharts, Chart.js) — a referência não tem gráficos complexos, só progress bars e badges.
- ❌ Criar rotas `/leads`, `/pipeline`, `/whatsapp`, `/configuracoes` etc. — apenas links inertes na sidebar.
- ❌ Refatorar o design system, tokens, ou qualquer arquivo em `design_system/`.

---

## ⚠️ Critérios de Aceite

- [ ] `npm install lucide-react` executado e `package.json` commitado com a nova dep.
- [ ] `/dashboard` renderiza sem erros em dev (`npm run dev`) e match visual com `design_system/telas_prontas/dashboard.html` em viewport 1440px (desktop) e 375px (mobile — sidebar oculta, conteúdo empilhado).
- [ ] `/` redireciona para `/dashboard` via `redirect()` do `next/navigation`.
- [ ] Todos os componentes listados existem nos caminhos exatos especificados acima.
- [ ] `src/lib/mocks/dashboard.ts` exporta todos os tipos e instâncias listados; nenhum componente do dashboard possui dados literais inline.
- [ ] Zero uso de `style={{}}` para cores, zero classes Tailwind arbitrárias (`bg-[#...]`), zero hex no JSX — apenas tokens semânticos do design system.
- [ ] Ícones exclusivamente via `lucide-react`; nenhum `<i data-lucide>` nem script CDN do Lucide.
- [ ] Sidebar marca "Dashboard" como ativo via `usePathname()` — **não** hardcoded.
- [ ] `AppLayout` aplicado via `src/app/(app)/layout.tsx` (route group) — não duplicado dentro da página.
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] `node scripts/verify-design.mjs --changed` sai com `✅ 0 violações` (GATE 5 estático).
- [ ] Guardian aprova sem violações críticas.

---

## 🧭 Notas para o Tech Lead

Sprint LIGHT segue **Workflow B (Maintenance)**:

- **Pula** geração de PRD pelo `@spec-writer`.
- **Pula** sanity check.
- Tech Lead delega direto para `@frontend` (toda a sprint é UI — não há Server Actions nem DB).
- `@guardian` valida o código.
- **GATE 2** (build + lint) e **GATE 5** (verify-design estático + comparação visual manual com `dashboard.html`) são obrigatórios.
- **Preflight Passo 4 (.env.local)** pode ser pulado: `git diff --name-only HEAD` não deve tocar `src/**/actions.ts`, `src/lib/supabase/**` nem `supabase/migrations/**`. Se tocar, o Passo 4 é exigido.
- Ao encerrar: atualizar [`docs/architecture_state.md`](../../docs/architecture_state.md) com a seção sobre `AppLayout`, rota `(app)/dashboard` e convenção de `src/lib/mocks/` (já que é o primeiro uso). Registrar em [`docs/APRENDIZADOS.md`](../../docs/APRENDIZADOS.md) apenas se surgir algo não-óbvio durante o build.
- Após encerramento, `@git-master` move este arquivo para `sprints/done/`.
