# Target Tech Stack

Stack esperado para projetos construídos sobre este framework. Versões concretas são pinadas pelo bootstrap sprint de cada projeto (via `package.json`). Este arquivo declara a **intenção** antes do bootstrap existir.

Quando um projeto já estiver bootstrapped, a fonte autoritativa passa a ser o `package.json` — este arquivo serve só como memória de design e para novos projetos clonados do framework vazio.

---

## Frontend

- **Framework:** Next.js 15 (App Router, Server Components, Server Actions)
- **Runtime:** React 19
- **Language:** TypeScript strict
- **Styling:** Tailwind CSS consumindo tokens gerados por [`design_system/`](../design_system/) — sem hex literals, sem classes primitivas de cor, sem valores arbitrários
- **UI Components:** wrappers finos sobre Radix Primitives (e React Aria quando Radix não cobre) em `src/components/ui/`, estilizados com tokens semânticos via `class-variance-authority`. Distribuição estilo Shadcn — você é dono do código, não é dependência. Contrato em [`design_system/components/CONTRACT.md`](../design_system/components/CONTRACT.md).
- **Icons:** Lucide Icons (logos de marca ficam como SVG assets em `src/assets/brands/`, não como ícones)
- **Forms & Validation:** react-hook-form + Zod 4 (nota: Zod 4 usa `.issues`, não `.errors` — ver [APRENDIZADOS.md](./APRENDIZADOS.md))

## Backend

- **Database:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth
- **API Surface:** Next.js Server Actions (nada de rotas REST custom exceto quando for obrigatório para webhooks)
- **Validation:** Zod 4 em toda borda de Server Action
- **Error shape:** `ActionResponse<T>` — contrato em [`agents/skills/error-handling/SKILL.md`](../agents/skills/error-handling/SKILL.md)
- **Lógica de negócio:** TypeScript, não SQL (sem RPCs fazendo regras de negócio complexas)

## Tooling

- **Package Manager:** npm (projeto pode trocar no bootstrap sprint — pinar em `package.json`)
- **Version Control:** Git + Conventional Commits (enforced pelo `@git-master`)
- **Build validation:** `npm run build` + `npm run lint` (GATE 2 no Tech Lead)
- **Design system build:** `npm run check` (key parity), `npm run build` (Style Dictionary), `npm run contrast` (WCAG AA) — CI em qualquer PR que toque `design_system/tokens/`

---

## O que NÃO pertence a este arquivo

- Versões específicas (vivem em `package.json`)
- Decisões de arquitetura do projeto concreto (vivem em [`architecture_state.md`](./architecture_state.md))
- Convenções de código (vivem em [`docs/conventions/`](./conventions/))
- Armadilhas descobertas durante sprints (vivem em [`APRENDIZADOS.md`](./APRENDIZADOS.md))
