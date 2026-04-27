# Convenções de Audit Log

> **Regra fundamental (INV-6):** toda ação sensível admin grava em `audit_log` **na mesma transação** via RPC `audit_write` (SECURITY DEFINER). Nenhuma mutation listada abaixo pode ser executada sem linha de audit correspondente.

---

## Contrato do helper TypeScript

```typescript
// src/lib/audit/write.ts
writeAudit(params: WriteAuditParams, request?: Request): Promise<string | null>
```

**Uso:** apenas em Server Actions **sem** RPC PL/pgSQL dedicada. Quando existe RPC dedicada (Sprints 05+), o `audit_write` é chamado **de dentro do corpo PL/pgSQL** — não pelo helper TS.

---

## Catálogo de ações

| Slug | target_type | Quem grava | Sprint |
|---|---|---|---|
| `org.create` | `organization` | RPC `admin_create_organization` | 05 |
| `org.suspend` | `organization` | RPC `admin_suspend_organization` | 05 |
| `org.reactivate` | `organization` | RPC `admin_reactivate_organization` | 05 |
| `plan.create` | `plan` | RPC `admin_create_plan` | 06 |
| `plan.update` | `plan` | RPC `admin_update_plan` | 06 |
| `plan.archive` | `plan` | RPC `admin_archive_plan` | 06 |
| `subscription.change_plan` | `subscription` | RPC `admin_change_plan` | 06 |
| `subscription.extend_trial` | `subscription` | RPC `admin_extend_trial` | 06 |
| `subscription.cancel` | `subscription` | RPC `admin_cancel_subscription` | 06 |
| `subscription.reactivate` | `subscription` | RPC `admin_reactivate_subscription` | 06 |
| `grant.create` | `plan_grant` | RPC `admin_grant_limit` | 07 |
| `grant.revoke` | `plan_grant` | RPC `admin_revoke_grant` | 07 |
| `setting.update` | `platform_setting` | RPC `admin_set_setting` | **09** |
| `feature_flag.set` | `feature_flag` | RPC `admin_set_feature_flag` | **09** |
| `legal_policy.create` | `legal_policy` | RPC `admin_create_legal_policy` | **09** |
| `metrics.refresh` | `platform_metrics_snapshot` | RPC `refresh_platform_metrics` | **09** |

> **Nota de Sprint 09:** `setting.update` e `feature_flag.set` usam `target_id=NULL` pois as PKs são `text` (não UUID). A key/flag identificadora vai em `metadata.key`. Isso é excepção documentada — audit_write aceita target_id nullable.

---

## Regras de adição de nova ação

Ao criar nova RPC ou Server Action sensível:
1. Adicionar linha neste catálogo antes de submeter a migration/action.
2. `target_id` é UUID quando a PK da tabela é UUID; NULL quando PK é text ou int (documenta via `metadata`).
3. `content_md` e campos grandes nunca vão em `diff_before`/`diff_after` — apenas metadados de identificação.
