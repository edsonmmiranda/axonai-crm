# Sprint admin_06: CRUD Plans + Ciclo de Vida de Subscription (STANDARD)

> **Nível:** STANDARD
> **PRD:** `prds/prd_admin_06_plans_subscription_lifecycle.md` (APROVADO — Opção 2)
> **Data de início:** 2026-04-25

---

## 🎯 Objetivo de Negócio

Permitir que a equipe Axon opere comercialmente via UI: criar/manter catálogo de planos, trocar o plano de uma organização, estender trials, cancelar e reativar subscriptions. Fecha o ciclo comercial do Sprint 01 (schema) + Sprint 05 (CRUD orgs).

## 📋 Escopo (resumo — PRD é o contrato autoritativo)

- 9 RPCs SECURITY DEFINER no banco
- `src/lib/actions/admin/plans.ts` + `plans.schemas.ts`
- `src/lib/actions/admin/subscriptions.ts` + `subscriptions.schemas.ts`
- `/admin/plans/` (lista, new, [id]/edit)
- `/admin/organizations/[id]/subscription` (lifecycle actions)
- Integration tests: `tests/integration/admin-plans.test.ts` + `admin-subscriptions.test.ts`

## 🚫 Fora de escopo
- Gateway de pagamento (fase 2)
- Hard-enforcement de limites nos Server Actions do customer app (Sprint 07)
- `pg_cron` para transições automáticas (Sprint 13)

---

## 🔄 Execução

> Atualizado a cada conclusão de agente. Fonte de verdade para retomada de sessão.

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| Banco de dados | `@db-admin` | ✅ Concluído | `supabase/migrations/20260425200000_admin_06_plans_subscription_rpcs.sql` |
| Server Actions | `@backend` | ✅ Concluído | `src/lib/actions/admin/plans.ts` · `plans.schemas.ts` · `subscriptions.ts` · `subscriptions.schemas.ts` |
| Integration Tests | `@qa-integration` | ✅ Concluído | `tests/integration/admin-plans.test.ts` (31 testes) · `admin-subscriptions.test.ts` (21 testes) |
| Frontend | `@frontend+` | ✅ Concluído | `src/app/admin/plans/` (3 páginas) · `src/app/admin/organizations/[id]/subscription/` · `src/components/admin/plans/` (5 componentes) · `src/components/admin/subscriptions/` (2 componentes) · AdminSidebar atualizado |
| Code Review | `@guardian` | ✅ Concluído | APPROVED — sem violações |
| Git | Tech Lead | ⬜ Pendente | — |

**Legenda:** ⬜ Pendente · ▶️ Em andamento · ✅ Concluído · ⏸️ Aguarda review
