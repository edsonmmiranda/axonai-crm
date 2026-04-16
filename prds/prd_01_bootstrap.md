# PRD: Bootstrap do Projeto

**Template:** PRD_STANDARD (adaptado — sprint de infraestrutura, não CRUD)
**Complexity Score:** 5 pontos (UI +2 / Deps externas +3)
**Sprint:** 01
**Created:** 2026-04-14
**Status:** Draft

> **Nota de contexto:** este é um **sprint de bootstrap** — não há tabela nova, não há Server Action de domínio, não há CRUD. O template PRD_STANDARD é seguido por convenção, mas as seções de Database e Server Actions são intencionalmente marcadas como N/A. A substância técnica vive nas seções 3 (arquivos de infraestrutura), 4 (layout raiz) e 6 (critérios de aceite operacionais).

---

## 1. Visão Geral

### Objetivo de Negócio

Inicializar o projeto Axon AI CRM sobre o framework vazio, entregando um scaffold Next.js 15 + Supabase + design system wiring funcional. Sem este sprint, nenhum módulo de domínio pode ser construído — `package.json`, `src/` e os clients do Supabase precisam existir antes de qualquer CRUD.

### User Story

- Como **desenvolvedor**, eu quero um projeto Next.js 15 inicializado com a stack padrão declarada em [`docs/stack.md`](../stack.md), para que eu possa começar a construir módulos CRUD sem decidir versões ou wiring ad-hoc a cada sprint.
- Como **designer/frontend**, eu quero Tailwind v4 consumindo os tokens semânticos já gerados em [`design_system/generated/`](../../design_system/generated/), para que nenhuma cor hex, classe primitiva de cor ou valor arbitrário apareça no código desde o primeiro commit.

### Métricas de Sucesso

- `npm install` + `npm run build` + `npm run lint` passam em sequência, sem erros nem warnings novos
- Rota `/` renderiza com tokens semânticos aplicados e dark mode funcional via `prefers-color-scheme`
- `src/lib/supabase/{client,server,middleware}.ts` compilam e exportam funções tipadas sem `any`
- Guardian aprova (gate único de design system)

---

## 2. Requisitos de Banco de Dados

**N/A — bootstrap sprint.**

Nenhuma nova tabela, migration ou mudança de schema. O baseline `supabase/migrations/00000000000000_framework_bootstrap.sql` já existe e provê os RPCs de introspecção do framework — nada mais é tocado no banco nesta sprint. `@db-admin` não é invocado.

---

## 3. Contrato de API

**N/A para Server Actions de domínio.**

Esta sprint não cria nenhuma Server Action. O que é criado é a **infraestrutura de cliente Supabase** que Server Actions futuras vão consumir. Contrato dessa infraestrutura:

### `src/lib/supabase/client.ts`

**Export:** `createClient(): SupabaseClient`
- Usa `createBrowserClient` de `@supabase/ssr`
- Lê `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` de `process.env`
- **Falha explícita** (`throw new Error(...)`) se qualquer env var estiver ausente ou vazia — mensagem acionável apontando para `.env.example`
- Tipado, zero `any`

### `src/lib/supabase/server.ts`

**Export:** `createClient(): Promise<SupabaseClient>` (async — precisa `await cookies()` no Next 15)
- Usa `createServerClient` de `@supabase/ssr`
- Recebe adaptador de cookies baseado em `cookies()` de `next/headers`
- Mesma validação de env vars que `client.ts`
- Segue o padrão oficial `@supabase/ssr` para Next.js 15 App Router

### `src/lib/supabase/middleware.ts`

**Export:** `updateSession(request: NextRequest): Promise<NextResponse>`
- Helper padrão `@supabase/ssr` para refrescar a sessão em edge runtime
- Retorna a `NextResponse` com cookies atualizados
- Usado pelo `middleware.ts` da raiz

### `middleware.ts` (raiz do repo)

**Export:** `middleware(request)` + `config.matcher`
- Chama `updateSession(request)`
- Matcher exclui `_next/static`, `_next/image`, `favicon.ico`, rotas de assets (`*.svg`, `*.png`, etc.)

### `src/lib/utils.ts`

**Export:** `cn(...inputs: ClassValue[]): string`
- `clsx` + `tailwind-merge` combinados — padrão Shadcn

**Retorno de todos os módulos:** nunca lança para o cliente final em runtime; erros de env são erros de **boot**, explícitos e ruidosos, que falham `npm run build` ou a primeira request de dev.

---

## 4. Componentes de UI

### Árvore de componentes

```
Page: /
└── RootLayout (src/app/layout.tsx)
    └── HomePage (src/app/page.tsx)
```

Nenhum componente reutilizável de `src/components/ui/` é criado nesta sprint. Essa camada nasce sob demanda nos sprints seguintes conforme CRUDs precisarem de `Button`, `Input`, `Dialog`, etc.

### `RootLayout` — `src/app/layout.tsx`

**Props:** `{ children: ReactNode }`

**Responsabilidades:**
- Declarar `<html lang="pt-BR">` com suporte a `data-theme` (dark/light)
- Importar `globals.css`
- Script inline clássico no `<head>` que lê `prefers-color-scheme` e aplica `data-theme` **antes** da hidratação React — evita FOUC
- Metadata básico: `title: "Axon AI CRM"`, `description: "..."`
- Fontes: nenhuma customizada nesta sprint — stack nativa do navegador

**Tokens semânticos esperados no `<body>`:**
- `bg-surface-base` (fundo base do app)
- `text-text-primary` (texto padrão)
- `font-sans` (ou token equivalente da escala tipográfica do design system)

### `HomePage` — `src/app/page.tsx`

**Props:** nenhuma (Server Component, sem estado)

**Comportamento:**
- Renderização estática. Exibe:
  - Título `h1` "Axon AI CRM" com tokens semânticos
  - Parágrafo de status "Framework bootstrap OK."
- Sem interações, sem fetch, sem estado

**Tokens semânticos:** somente `bg-surface-*`, `text-text-*`. Zero hex, zero `bg-blue-500`, zero `p-[17px]`, zero `style={{}}`.

> 🎨 **Regras de design system**: componentes seguem [`design_system/components/CONTRACT.md`](../../design_system/components/CONTRACT.md). Nesta sprint não há componentes reutilizáveis sendo criados — apenas o layout raiz e uma landing estática consumindo tokens já gerados em [`design_system/generated/`](../../design_system/generated/). O wiring do Tailwind (`tailwind.config.ts`) deve importar esses tokens para que as classes `bg-surface-*` e `text-text-*` resolvam em CSS válido.

---

## 5. Edge Cases

### Configuração de ambiente

- [ ] **`.env.local` ausente ou env vars vazias:** `src/lib/supabase/client.ts` e `server.ts` lançam `Error` explícito com mensagem: `"Missing NEXT_PUBLIC_SUPABASE_URL. Copy .env.example to .env.local and fill it."` — nunca silenciar, nunca usar fallback.

### Renderização

- [ ] **Dark mode flash on load:** script inline no `<head>` aplica `data-theme` antes da hidratação; sem FOUC mesmo em primeiro load.

### Build e tooling

- [ ] **Path alias quebrado:** `tsconfig.json` (`paths: { "@/*": ["./src/*"] }`) + Next.js precisam concordar. Validação: importar `@/lib/utils` em `src/app/page.tsx` e garantir que `npm run build` passa.
- [ ] **Token do design system não encontrado:** se `design_system/generated/` não expor o shape esperado pelo `tailwind.config.ts`, o build falha com erro claro (nunca gera CSS silenciosamente quebrado). @frontend valida o caminho real durante a execução e ajusta o import.
- [ ] **Middleware matcher excedendo escopo:** matcher padrão do Next.js pode interceptar assets. O matcher exclui explicitamente `_next/static`, `_next/image`, `favicon.ico`, e extensões comuns de imagem/fonte via regex.

### Dependências

- [ ] **Node version mismatch:** `package.json` declara `engines.node >= 20` (Next 15 exige). `npm install` avisa se o ambiente local estiver abaixo disso.
- [ ] **Duplicate lockfile:** apenas `package-lock.json` existe. Se `yarn.lock` ou `pnpm-lock.yaml` forem gerados acidentalmente, devem ser removidos antes do commit.

---

## 6. Critérios de Aceite

### Banco de dados

- [x] N/A — sem mudanças de banco nesta sprint.

### Backend (infraestrutura Supabase)

- [ ] `src/lib/supabase/client.ts`, `server.ts`, `middleware.ts` compilam com TypeScript strict
- [ ] Nenhum `any` em nenhum dos três arquivos
- [ ] Validação explícita de env vars com mensagem de erro acionável
- [ ] `middleware.ts` da raiz compila e o matcher exclui assets estáticos
- [ ] `src/lib/utils.ts` exporta `cn()` tipado

### Frontend

- [ ] **Design system:** o código passa em **todas as checagens** do [`agents/quality/guardian.md`](../../agents/quality/guardian.md) § 1a e § 1b. A fonte normativa é [`design_system/enforcement/rules.md`](../../design_system/enforcement/rules.md) e [`design_system/components/CONTRACT.md`](../../design_system/components/CONTRACT.md). **Zero** hex literals, classes primitivas de cor, ou valores arbitrários em `src/`.
- [ ] `src/app/layout.tsx` aplica `data-theme` via script inline antes da hidratação (sem FOUC)
- [ ] `src/app/page.tsx` renderiza com tokens semânticos apenas
- [ ] `node scripts/verify-design.mjs --changed` sai com código 0

### Build & tooling

- [ ] `npm install` completa sem erros nem peer-dependency warnings críticos
- [ ] `npm run build` passa
- [ ] `npm run lint` passa sem warnings novos
- [ ] `package.json` declara `engines.node >= 20`
- [ ] Apenas `package-lock.json` existe como lockfile

### Documentação

- [ ] `docs/architecture_state.md` atualizado com narrativa do bootstrap (versões escolhidas, por quê, decisões arquiteturais feitas durante o sprint)
- [ ] `docs/architecture_state.auto.md` regenerado via `node scripts/generate-architecture-inventory.mjs`

---

## 7. Rollback

**Se problemas forem encontrados após o commit:**

1. Reverter commit: `git revert HEAD`
2. Se o `node_modules/` estiver corrompido: `rm -rf node_modules package-lock.json && npm install` (não aplica no rollback em si, aplica no retry após fix)
3. Rollback de banco: **N/A** — sem mudanças de banco.

**Se problemas forem encontrados antes do commit (durante GATE 2):**

- Tech Lead roda `git restore .` e remove `package.json`, `package-lock.json`, `src/`, `tsconfig.json`, `next.config.mjs`, `postcss.config.mjs`, `tailwind.config.ts`, `eslint.config.*`, `middleware.ts` (arquivos criados nesta sprint).
- Delega retry ao agente que falhou com o output literal do erro como contexto.

**Tempo estimado de rollback:** 2 minutos (working tree) ou 5 minutos (commit).
