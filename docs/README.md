# 📚 Documentation Index

This folder is the **documentation hub** of the SaaS Factory framework. The framework itself is a **reusable empty shell** — there is no application code yet. The first sprint of any new project built on top of it is a **bootstrap sprint** that creates `package.json`, `src/`, and the Supabase client.

For the canonical source of truth on *what has been built* in the current project, see [architecture_state.md](./architecture_state.md).

---

## 🗺️ Map of this folder

| File / Folder | Purpose | Who writes | Who reads |
|---|---|---|---|
| [GETTING_STARTED.md](./GETTING_STARTED.md) | Manual do operador: como iniciar um projeto novo e operar o framework no dia a dia | — | **Humanos (operadores) — leia primeiro** |
| [stack.md](./stack.md) | Target tech stack declared by the framework (pinned to `package.json` in each project) | — | Tech Lead, bootstrap sprints |
| [conventions/crud.md](./conventions/crud.md) | Framework-level CRUD rules (paths, naming, URL-as-truth, toasts, danger zone, pagination) | — | `@frontend`, `@backend`, `@spec-writer`, `@guardian` |
| [architecture_state.md](./architecture_state.md) | Living memory of what the current project has built (modules, integrations, change log) | Tech Lead (end of Workflow A sprints) | Tech Lead, `@spec-writer`, all agents during context load |
| [APRENDIZADOS.md](./APRENDIZADOS.md) | Append-only log of surprising traps and non-obvious patterns discovered during sprints | Any agent that discovers a non-obvious trap | Every agent during planning |
| [design-system.md](./design-system.md) | Short pointer to [`design_system/`](../design_system/) — the real design system lives there | — | `@frontend`, `@spec-writer`, `@guardian` |
| [PROCESS_DESIGN_VERIFICATION.md](./PROCESS_DESIGN_VERIFICATION.md) | Manual verification checklist (CRUD, Report, Landing Page) used in GATE 5 | — | Tech Lead during Workflow A Step 5 |
| [schema_snapshot.json](./schema_snapshot.json) | Real database schema snapshot, introspected from Supabase | `@db-admin` (overwritten on each introspection) | Any agent that needs to know the real DB shape |
| [templates/](./templates/) | PRD templates (PRD_LIGHT, PRD_STANDARD, PRD_COMPLETE) + Server Action templates | — | `@spec-writer`, `@sanity-checker`, `@backend` |
| [api_research/](./api_research/) | Phase 1 outputs from `@api-integrator` (research reports before implementation) | `@api-integrator` | Tech Lead, user (review checkpoint), `@api-integrator` Phase 2 |

---

## 🧠 The three memory layers

Full specification lives in [`agents/workflows/memory-layers.md`](../agents/workflows/memory-layers.md) — **single source of truth**. Quick reference:

| Layer | Where | Lifecycle |
|---|---|---|
| **Real DB shape** | `docs/schema_snapshot.json` | Overwritten on each `@db-admin` introspection |
| **What was built** | `docs/architecture_state.md` | Append-only, one entry per sprint |
| **Surprising traps and patterns** | `docs/APRENDIZADOS.md` | Append-only, only when something non-obvious happened |

---

## 🚦 Before starting any new task

Every agent (and the user) should read, in this order:

1. [`CLAUDE.md`](../CLAUDE.md) — boot file (auto-loaded by Claude Code); contains the "Tech Lead..." trigger and hard harness rules
2. [`agents/00_TECH_LEAD.md`](../agents/00_TECH_LEAD.md) — the dual-workflow protocol (A/B), validation gates, rollback rules
3. [`docs/architecture_state.md`](./architecture_state.md) — current project state (may declare the framework is empty)
4. [`docs/conventions/crud.md`](./conventions/crud.md) — framework-level CRUD rules

If `architecture_state.md` says the project is in **EMPTY FRAMEWORK** state, the first sprint must be a bootstrap sprint — see the Tech Lead's PREFLIGHT section for the bootstrap detection rule.

---

## ✍️ Maintaining this folder

- Keep this index in sync when new canonical docs are added.
- Do **not** add tutorials, code examples, or narrative documentation here — those belong in `docs/conventions/` or in the relevant agent file under `agents/`.
- Do **not** log sprint history here — that is the job of `architecture_state.md`.
