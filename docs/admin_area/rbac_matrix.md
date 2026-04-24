# Matriz RBAC — Área Administrativa (Axon AI CRM)

> **Sprint:** admin_02 · **Data:** 2026-04-24
> **Fonte de ações:** [`docs/admin_area/sprint_plan.md`](sprint_plan.md) — ações literalmente nomeadas nos Sprints 05–13.

## Princípio de ortogonalidade

`profiles.role` (`owner | admin | user | viewer`) e `platform_admins.role` (`owner | support | billing`) são **ortogonais e independentes**:

- `profiles.role` — papel do usuário **dentro de uma org-tenant** (customer app).
- `platform_admins.role` — papel do operador da **plataforma Axon** (admin area).

Nenhuma conversão entre os dois é válida. Um usuário pode ser `owner` em `profiles` (da org dele) e não existir em `platform_admins`. Um platform admin pode ser `support` e ter `profiles.role = 'user'` na org interna. Os dois modelos operam em superfícies completamente separadas.

## Aviso de uso

**Esta matriz é contrato humano, não código autoritativo.** Cada RPC nos sprints 05+ valida papel no próprio corpo (defesa em profundidade). Quando matriz e código divergem, código vence — abrir PR dedicado para atualizar a matriz.

## Papéis

| Papel | Quem | Resumo |
|---|---|---|
| **owner** | Edson + sócios | Acesso total a tudo |
| **support** | Atendimento Axon | Leitura + inspeção + audit; sem tocar plans/subs/admins |
| **billing** | Financeiro Axon | Ciclo comercial (plans/subs/grants); sem tocar admins/settings/credenciais |

## Matriz de permissões

Legenda: `✓` = permitido · `—` = negado · `R` = read-only

| Ação (RPC / módulo) | Sprint | owner | support | billing |
|---|---|---|---|---|
| **Sprint 05 — Organizations** | | | | |
| `admin_suspend_organization(org_id, reason)` | 05 | ✓ | — | — |
| `admin_reactivate_organization(org_id)` | 05 | ✓ | — | — |
| `admin_create_organization(name, slug, plan_id, first_admin_email)` | 05 | ✓ | — | — |
| Listagem de organizations (read) | 05 | R | R | R |
| Detalhe de organization (read) | 05 | R | R | R |
| **Sprint 06 — Plans & Subscriptions** | | | | |
| `admin_change_plan(subscription_id, new_plan_id, effective_at)` | 06 | ✓ | — | ✓ |
| `admin_extend_trial(subscription_id, days)` | 06 | ✓ | — | ✓ |
| `admin_cancel_subscription(subscription_id, effective_at)` | 06 | ✓ | — | ✓ |
| `admin_reactivate_subscription(subscription_id)` | 06 | ✓ | — | ✓ |
| `admin_archive_plan(plan_id)` | 06 | ✓ | — | ✓ |
| `admin_delete_plan(plan_id)` | 06 | ✓ | — | ✓ |
| CRUD de `plans` (UI) | 06 | ✓ | — | ✓ |
| Listagem de subscriptions (read) | 06 | R | R | R |
| **Sprint 07 — Grants & Limits** | | | | |
| `admin_grant_limit(org_id, limit_key, value, reason, expires_at)` | 07 | ✓ | — | ✓ |
| `admin_revoke_grant(grant_id)` | 07 | ✓ | — | ✓ |
| Listagem de grants (read) | 07 | R | R | R |
| **Sprint 08 — Deep Inspect** | | | | |
| `inspect_log(org_id, resource_type, record_ids[])` | 08 | ✓ | ✓ | — |
| Read-only de leads/users/products/pipelines/categorias/tags/origins/loss_reasons/whatsapp_groups | 08 | R | R | — |
| **Sprint 09 — Dashboard & Settings base** | | | | |
| `refresh_platform_metrics()` | 09 | ✓ | ✓ | ✓ |
| `admin_set_feature_flag(key, enabled, config)` | 09 | ✓ | — | — |
| `admin_update_platform_setting(key, value)` (trial default, past_due grace) | 09 | ✓ | — | — |
| CRUD de `legal_policies` (novas versões) | 09 | ✓ | — | — |
| **Sprint 10 — Integration credentials** | | | | |
| CRUD de `platform_integration_credentials` (email/SMS) | 10 | ✓ | — | — |
| Rotação de credenciais | 10 | ✓ | — | — |
| `get_credential(id)` (via server-side whitelist) | 10 | ✓ | — | — |
| **Sprint 11 — Platform admins** | | | | |
| `admin_create_platform_admin_invitation(email, role)` | 11 | ✓ | — | — |
| `admin_deactivate_platform_admin(admin_id)` | 11 | ✓ | — | — |
| `admin_change_platform_admin_role(admin_id, new_role)` | 11 | ✓ | — | — |
| Listagem de `platform_admins` (read) | 11 | R | R (sem metadata sensível) | R (sem metadata sensível) |
| Password reset + re-enroll MFA (self) | 11 | ✓ | ✓ | ✓ |
| **Sprint 12 — Audit UI, Rate limit, Break-glass** | | | | |
| Visualizar `audit_log` (UI) | 12 | R | R | R (escopo billing apenas) |
| `login_attempts_admin` (read) | 12 | R | R | — |
| CLI `scripts/break-glass.ts` (fora do modelo de papel — double-key) | 12 | n/a | n/a | n/a |
| **Sprint 13 — Transitions & deploy ops** | | | | |
| Reconfigurar slug via runbook (INV-9) | 13 | ✓ (via DB, fora da UI) | — | — |
