# Admin Area — Documentação de Planejamento

> **Status:** Planejamento aprovado, aguardando execução do Sprint 0.
> **Data da decisão:** 2026-04-23
> **Owner do produto:** Edson Miranda

Esta pasta contém o planejamento completo da **Área Administrativa do SaaS** — dashboard que os donos do Axon AI (não os clientes) usarão para gerenciar empresas-clientes, planos, assinaturas e configurações globais.

A documentação foi escrita para que **uma sessão limpa** (sem contexto anterior) consiga retomar o trabalho lendo apenas os arquivos desta pasta. Se você é um Tech Lead abrindo essa pasta pela primeira vez, comece pelo `06-handoff.md`.

---

## Ordem de leitura

| # | Documento | O que contém |
|---|---|---|
| 1 | [00-contexto-e-decisoes.md](./00-contexto-e-decisoes.md) | Problema, escopo MVP, todas as decisões fixadas, opções consideradas e rejeitadas |
| 2 | [01-arquitetura.md](./01-arquitetura.md) | Estrutura de pastas, fluxos de auth, padrão service_role, fluxo de impersonation |
| 3 | [02-schema-banco.md](./02-schema-banco.md) | Especificação completa das 7 tabelas novas + seeds + backfill |
| 4 | [03-seguranca.md](./03-seguranca.md) | `assertPlatformAdmin`, audit log, MFA, impersonation token, RLS das tabelas globais |
| 5 | [04-mudancas-framework.md](./04-mudancas-framework.md) | Sprint 0 — os 6 arquivos do framework que precisam ajuste antes do S1 |
| 6 | [05-roadmap-sprints.md](./05-roadmap-sprints.md) | S0 a S9 com escopo, dependências, Target app, critérios de aceite |
| 7 | [06-handoff.md](./06-handoff.md) | Como retomar o trabalho em sessão nova — gatilho, pré-requisitos, primeira ação |

---

## Como retomar em nova sessão

Em uma sessão limpa, digite:

```
Tech Lead, leia docs/admin_area/ por completo e execute o Sprint 0.
```

O Tech Lead vai ler todos os docs desta pasta, confirmar o entendimento com você, e então iniciar a execução do Sprint 0 (ajustes leves no framework antes do primeiro sprint de feature).

**Alternativa** — se quiser fazer uma revisão antes de executar:

```
Tech Lead, leia docs/admin_area/ e me dê um resumo do que entendeu.
```

---

## Decisões fechadas (não rediscutir)

| Aspecto | Decisão | Onde está o detalhe |
|---|---|---|
| Arquitetura | Opção 3 — route group `(admin)` no mesmo Next.js app | [00](./00-contexto-e-decisoes.md), [01](./01-arquitetura.md) |
| Identidade admin | Tabela isolada `platform_admins` (sem `organization_id`) | [02](./02-schema-banco.md), [03](./03-seguranca.md) |
| Billing | Fase 2 (sem Stripe no MVP) | [00](./00-contexto-e-decisoes.md), [05](./05-roadmap-sprints.md) |
| Impersonation | Day-1 (Sprint S3) | [01](./01-arquitetura.md), [03](./03-seguranca.md) |
| Métricas v1 | 3 KPIs simples (orgs ativas, users totais, leads totais) | [05](./05-roadmap-sprints.md) |
| Banco | Mesmo Supabase project, admin via `service_role` gated | [01](./01-arquitetura.md), [03](./03-seguranca.md) |
| Auth | Mesmo `auth.users`, separação lógica por tabela de perfil | [01](./01-arquitetura.md) |

---

## Questões ainda abertas (resolver conforme andamento)

- **Subdomínio vs path prefix** para servir a área admin — decidir no Sprint 2.
- **Gateway de pagamento fase 2** (Stripe / Pagar.me / Asaas) — decidir quando chegar o sprint correspondente.
- **Escopo exato das feature flags** no Sprint 8 — aberto para refinamento quando iniciar o sprint.

---

## Convenções desta documentação

- **Linguagem:** Português (alinhado ao framework).
- **Formato:** Markdown com tabelas e blocos de código.
- **DDL SQL:** Em [02-schema-banco.md](./02-schema-banco.md) o SQL está em forma canônica (idempotent, com `IF NOT EXISTS`), mas é **referência** — a migration final é gerada pelo `@db-admin` no Sprint 1 dentro dos padrões do framework.
- **Paths:** Absolutos a partir da raiz do repo (ex: `src/app/(admin)/` significa `d:/AiProjects/axonai-crm/src/app/(admin)/`).
