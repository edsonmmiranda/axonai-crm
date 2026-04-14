# axonai-framework

Framework reutilizável para construir SaaS com Claude Code como Tech Lead orquestrador. Este repositório é uma **casca vazia** — não contém código de aplicação. Cada projeto novo nasce a partir dele e começa por um **sprint de bootstrap** que cria `package.json`, `src/` e o cliente Supabase.

---

## 🚀 Como usar

### Criar um projeto novo a partir deste template

1. No GitHub, clique em **"Use this template" → Create a new repository**
2. Clone o projeto recém-criado
3. Abra no Claude Code — o [`CLAUDE.md`](./CLAUDE.md) é carregado automaticamente
4. Inicie uma conversa com a mensagem começando por **"Tech Lead..."** (gatilho obrigatório)

### Atualizar um projeto já existente com novidades do framework

Dentro do projeto derivado:
```bash
bash scripts/update-framework.sh            # puxa do main
bash scripts/update-framework.sh v1.2.0     # puxa tag/branch específica
```
O script sobrescreve **somente** as pastas do framework (`agents/`, `docs/conventions/`, `design_system/`, `CLAUDE.md`, etc.) e preserva o código do projeto (`src/`, `sprints/`, migrations de feature, `.env*`).

---

## 🗺️ Estrutura

| Pasta / Arquivo | Propósito |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | Boot file do harness (carregado automaticamente pelo Claude Code) |
| [`agents/`](./agents/) | Definições de agentes (Tech Lead, Backend, Frontend, Guardian, etc.) |
| [`agents/00_TECH_LEAD.md`](./agents/00_TECH_LEAD.md) | Protocolo dual-workflow (A/B), validation gates, rollback |
| [`docs/conventions/`](./docs/conventions/) | Regras invioláveis: standards, CRUD, paths canônicos |
| [`docs/templates/`](./docs/templates/) | Templates de PRD, Server Actions, módulo de referência |
| [`design_system/`](./design_system/) | Design system (tokens, catálogo de componentes, recipes) |
| [`sprints/TEMPLATE_SPRINT_*.md`](./sprints/) | Templates de sprint (Light e Standard) |
| [`scripts/`](./scripts/) | Utilitários (verify-design, telemetria, update-framework) |

---

## 🧠 Filosofia

- **Tech Lead como orquestrador:** o usuário conversa com um único agente que delega para agentes especialistas (`@backend`, `@frontend`, `@guardian`...).
- **Observer mode por padrão:** nada é executado até o gatilho explícito `"Tech Lead..."`.
- **Validation gates:** todo sprint passa por 5 portões antes de ser considerado concluído.
- **Memória em camadas:** schema real, arquitetura construída e armadilhas aprendidas — cada um com ciclo de vida próprio.
- **Fonte única de verdade:** cada regra mora em exatamente um lugar; o boot file só aponta.

---

## 📖 Leitura obrigatória antes do primeiro sprint

Na ordem:

1. [`CLAUDE.md`](./CLAUDE.md) — boot do harness
2. [`agents/00_TECH_LEAD.md`](./agents/00_TECH_LEAD.md) — workflow completo
3. [`docs/conventions/standards.md`](./docs/conventions/standards.md) — regras invioláveis
4. [`docs/architecture_state.md`](./docs/architecture_state.md) — estado atual do projeto
5. [`docs/conventions/crud.md`](./docs/conventions/crud.md) — se o sprint envolve CRUD

---

## 🔄 Evolução do framework

Este repositório continua sendo atualizado. Projetos já criados **não recebem** updates automáticos — use `scripts/update-framework.sh` dentro deles quando quiser puxar as novidades.

---

## 🛡️ Guardrails absolutos

- Nunca modifique `.env.local`
- Nunca rode `git reset --hard` ou `git push --force`
- Nunca pule hooks (`--no-verify`) nem bypass de signing

Demais regras invioláveis estão em [`docs/conventions/standards.md`](./docs/conventions/standards.md).
