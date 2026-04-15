# Sprint 01: Bootstrap do Projeto (STANDARD)

> **Nível:** STANDARD
> **Tipo:** Bootstrap sprint — inicializa Next.js + Supabase + design system wiring em cima do framework vazio.

---

## 🎯 Objetivo de Negócio

Transformar o framework vazio em um projeto Next.js/Supabase funcional, pronto para receber o primeiro módulo de domínio do Axon AI CRM. Sem este sprint, nenhum outro sprint pode rodar — `package.json`, `src/` e os clients do Supabase precisam existir antes que qualquer CRUD seja construído.

**Métrica de sucesso:** `npm run build` + `npm run lint` passam, rota `/` renderiza com tokens do design system aplicados, clientes Supabase (browser + server) compilam sem erro.

## 👤 User Stories

- Como desenvolvedor, eu quero um projeto Next.js 15 inicializado com a stack padrão do framework, para que eu possa começar a construir módulos sem decidir versões ou wiring ad-hoc.
- Como desenvolvedor, eu quero os clients do Supabase (browser, server, middleware) pré-configurados e tipados, para que Server Actions possam autenticar e consultar o banco desde o primeiro CRUD.
- Como designer/frontend, eu quero Tailwind v4 consumindo os tokens gerados em `design_system/generated/`, para que nenhuma cor hex ou classe primitiva de cor apareça no código.

## 🎨 Referências Visuais

- **Layout:** landing mínima em `/` — apenas título "Axon AI CRM" e parágrafo de status. Nada de navbar, sidebar ou auth nesta sprint.
- **Design system:** tokens semânticos de [`design_system/generated/`](../design_system/generated/). Sem hex, sem `bg-blue-500`, sem `p-[17px]`.
- **Componentes:** nenhum componente de UI além do layout raiz. `src/components/ui/` fica vazio — os wrappers Shadcn-style entram sprint a sprint conforme demanda.
- **Gold Standard:** N/A — este é o primeiro sprint.

## 🧬 Reference Module Compliance

N/A — este é o primeiro sprint do projeto; não há módulo de referência ainda. Os próximos sprints CRUD vão referenciar o primeiro módulo construído (provavelmente Leads).

## 📋 Funcionalidades (Escopo)

### Tooling & Config (raiz do repo)

- [ ] **`package.json`** com dependências:
  - `next@^15`, `react@^19`, `react-dom@^19`
  - `typescript@^5`, `@types/node`, `@types/react`, `@types/react-dom`
  - `tailwindcss@^4`, `@tailwindcss/postcss`, `postcss`
  - `@supabase/supabase-js`, `@supabase/ssr`
  - `react-hook-form`, `@hookform/resolvers`, `zod@^4`
  - `lucide-react`
  - `@radix-ui/react-slot` (base — outros Radix virão por demanda)
  - `class-variance-authority`, `clsx`, `tailwind-merge`
  - Dev: `eslint`, `eslint-config-next`
  - Scripts: `dev`, `build`, `start`, `lint`, `check` (futuro — design system)

- [ ] **`tsconfig.json`** strict, path alias `@/*` → `src/*`, `moduleResolution: bundler`, `jsx: preserve`.

- [ ] **`next.config.mjs`** — config mínima, `reactStrictMode: true`.

- [ ] **`postcss.config.mjs`** — `@tailwindcss/postcss` plugin.

- [ ] **`tailwind.config.ts`** — `content: ['./src/**/*.{ts,tsx}']`, `darkMode: 'class'`, `theme.extend` importando tokens de [`design_system/generated/tailwind.config.js`](../design_system/generated/tailwind.config.js) (ou equivalente — o @frontend valida o path real no bootstrap).

- [ ] **`.gitignore`** — verificar que inclui `node_modules/`, `.next/`, `.env.local`, `.env*.local`, build artifacts.

- [ ] **`eslint.config.mjs`** ou `.eslintrc.json` — baseline `next/core-web-vitals` + regra proibindo `any`.

### Src tree inicial

- [ ] **`src/app/layout.tsx`** — root layout, importa `globals.css`, define `<html lang="pt-BR" className={...}>` com dark mode via `prefers-color-scheme` (classe aplicada por script inline clássico para evitar flash).

- [ ] **`src/app/page.tsx`** — landing mínima, Server Component, título "Axon AI CRM" + parágrafo "Framework bootstrap OK." Usa apenas tokens semânticos (`bg-surface-*`, `text-text-*`).

- [ ] **`src/app/globals.css`** — `@import "tailwindcss"`, importa CSS vars geradas pelo design system (de `design_system/generated/`).

- [ ] **`src/lib/supabase/client.ts`** — `createBrowserClient` de `@supabase/ssr`, lê `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

- [ ] **`src/lib/supabase/server.ts`** — `createServerClient` de `@supabase/ssr` com `cookies()` de `next/headers`. Export `createClient()` async.

- [ ] **`src/lib/supabase/middleware.ts`** — helper `updateSession(request)` que refresca a sessão do Supabase (padrão oficial `@supabase/ssr`).

- [ ] **`middleware.ts`** (raiz) — usa `updateSession`, matcher que exclui estáticos (`_next`, `favicon`, imagens).

- [ ] **`src/lib/utils.ts`** — helper `cn()` usando `clsx` + `tailwind-merge`.

### Banco de dados

Nenhuma nova migration nesta sprint. O baseline `supabase/migrations/00000000000000_framework_bootstrap.sql` já existe e provê os RPCs de introspecção — nada mais a fazer no banco.

## 🧪 Edge Cases (obrigatório listar)

- [ ] **`.env.local` ausente:** `src/lib/supabase/client.ts` e `server.ts` devem **lançar erro explícito** com mensagem acionável se `NEXT_PUBLIC_SUPABASE_URL` ou `NEXT_PUBLIC_SUPABASE_ANON_KEY` estiverem ausentes/vazios. Nunca silenciar.
- [ ] **Dark mode flash on load:** layout raiz deve aplicar classe `dark`/`light` via script inline **antes** do React hidratar — sem FOUC.
- [ ] **Path alias não resolvido:** `tsconfig.json` + Next.js devem concordar no alias `@/*`. Verificação: importar `@/lib/utils` em `src/app/page.tsx` e garantir que build passa.
- [ ] **Token do design system não encontrado:** se `design_system/generated/` não exportar o shape esperado pelo `tailwind.config.ts`, reportar erro claro no build em vez de gerar CSS silenciosamente quebrado.
- [ ] **Middleware matcher excedendo escopo:** matcher padrão do Next.js middleware pode interceptar assets. Garantir que o matcher exclui `_next/static`, `_next/image`, `favicon.ico` e similares.
- [ ] **Node version mismatch:** `package.json` deve declarar `engines.node` >= 20 (Next 15 exige).
- [ ] **Duplicate lockfile:** confirmar que apenas `package-lock.json` existe (npm como package manager declarado em [docs/stack.md](../docs/stack.md)).

## 🚫 Fora de escopo

- Nenhum módulo CRUD, nenhuma tabela de domínio, nenhuma Server Action de negócio.
- Nenhuma tela de autenticação (login, signup, reset). Sessão fica refreshada pelo middleware, mas UI de auth é sprint futuro.
- Nenhum componente `ui/` além do mínimo (não criar `Button`, `Input`, `Dialog`, etc. — virão sprint a sprint conforme o primeiro CRUD precisar).
- Sidebar, navbar, dashboard layout — fora de escopo. O `src/app/page.tsx` é só landing placeholder.
- Nenhuma integração com API externa.
- Testes automatizados (vitest, playwright) — não fazem parte do framework padrão.
- CI/CD workflows (`.github/workflows/`) — sprint dedicado se/quando necessário.

## ⚠️ Critérios de Aceite

- [ ] `npm install` completa sem erros
- [ ] `npm run build` passa sem erros
- [ ] `npm run lint` passa sem warnings novos
- [ ] Rota `/` renderiza "Axon AI CRM" com tokens semânticos aplicados
- [ ] Dark mode funcional via `prefers-color-scheme` (alternar tema do SO troca visual sem reload)
- [ ] `src/lib/supabase/client.ts` e `server.ts` compilam e exportam funções tipadas
- [ ] `middleware.ts` compila e o matcher exclui assets estáticos
- [ ] Nenhum `any` no código produzido
- [ ] Nenhum hex literal, classe primitiva de cor ou valor arbitrário Tailwind em `src/`
- [ ] **Guardian aprova o código** — gate único para compliance de design system
- [ ] `docs/architecture_state.md` atualizado registrando o bootstrap (narrativa: por que essas escolhas, versões pinadas)
- [ ] Inventário regenerado via `node scripts/generate-architecture-inventory.mjs`

---

## 🧭 Notas para o Tech Lead

Sprint STANDARD segue **Workflow A** completo, mas com adaptações por ser bootstrap:

1. **Preflight:** já rodou — bootstrap detectado, `.env.example` criado. Passo 4 (`.env.local` real) fica **adiado** até depois do próximo sprint, pois este sprint não faz chamadas de runtime ao Supabase — só cria os clients.
2. `@spec-writer` gera PRD em `docs/prds/prd_01_bootstrap.md`.
3. `@sanity-checker` valida PRD.
4. **STOP & WAIT** pela aprovação do usuário.
5. **Execução adaptada:**
   - `@db-admin` → **pulado** (sem mudanças de banco)
   - `@api-integrator` → **pulado** (sem integração externa)
   - `@backend` → cria `src/lib/supabase/{client,server,middleware}.ts`, `src/lib/utils.ts`, `middleware.ts`
   - `@frontend` → cria `package.json`, `tsconfig.json`, configs Next/Tailwind/PostCSS, `src/app/{layout,page}.tsx`, `src/app/globals.css`
   - `@guardian` → revisa compliance (design system + regras de código)
6. **Gates:**
   - GATE 1 (DB) — pulado
   - GATE 2 (build + lint) — **habilitado a partir deste sprint**, mas só roda depois de `npm install`
   - GATE 3 (API) — pulado
   - GATE 4 (Guardian) — obrigatório
   - GATE 5 (design) — estático obrigatório; visual manual proporcional (só há uma página)
7. **Closing:** atualizar `docs/architecture_state.md` (narrativa do bootstrap), rodar inventário, `@git-master` commita.
