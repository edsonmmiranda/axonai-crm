# Convenção: Audit Log

## Regra fundamental

Toda ação sensível da área admin **deve** produzir uma linha em `audit_log` na **mesma transação** que a mutation (INV-6, G-03).

---

## Como garantir transacionalidade

### Mutations com RPC dedicada — caminho padrão (Sprints 05+)

Chame `audit_write` de **dentro do corpo PL/pgSQL** da RPC de ação. Tudo fica em uma transação automática.

```sql
-- Dentro de admin_suspend_organization (exemplo):
PERFORM public.audit_write(
  action                 => 'org.suspend',
  target_type            => 'organization',
  target_id              => p_org_id,
  target_organization_id => p_org_id,
  diff_before            => to_jsonb(v_org_before),
  metadata               => jsonb_build_object('reason', p_reason),
  ip_address             => p_ip_address::inet,
  user_agent             => p_user_agent
);
```

A RPC de ação recebe `p_ip_address text` e `p_user_agent text` do TypeScript:

```typescript
// Server Action — extrai ip/ua e passa para a RPC:
await supabase.rpc('admin_suspend_organization', {
  p_org_id: orgId,
  p_reason: reason,
  p_ip_address: extractIpFromRequest(request),
  p_user_agent: request.headers.get('user-agent'),
});
// Não chama writeAudit aqui — o audit já foi feito dentro da RPC.
```

### Mutations sem RPC dedicada — best-effort

```typescript
// audit: best-effort
await writeAudit(
  { action: 'feature_flag.set', targetType: 'feature_flag', bestEffort: true },
  request
);
```

Usar `bestEffort: true` sinaliza explicitamente que a falha no audit não rola back a mutation. Documentar no código com comentário `// audit: best-effort`.

---

## O que é "ação sensível"

Qualquer mutation em: `organizations`, `subscriptions`, `plans`, `platform_admins`, `plan_grants`, `platform_settings`, `feature_flags`, `legal_policies`, `platform_integration_credentials`.

Também: inspeção via Deep Inspect (Sprint 08), rate limit de login (Sprint 12), break-glass (Sprint 12).

**Não são ações sensíveis:** leituras paginadas, filtros de listagem, refresh de métricas por polling, falhas de validação no frontend.

---

## Padrão de slug

Formato: `'<domínio>.<verbo>'` em snake_case. Verbo no passado.

| Domínio | Exemplos de slug |
|---|---|
| `org` | `org.create`, `org.suspend`, `org.reactivate` |
| `subscription` | `subscription.change_plan`, `subscription.extend_trial`, `subscription.cancel`, `subscription.reactivate` |
| `plan` | `plan.create`, `plan.update`, `plan.archive`, `plan.delete` |
| `limit` | `limit.grant`, `limit.revoke` |
| `inspect` | `inspect.read_leads`, `inspect.read_products`, `inspect.read_users` |
| `feature_flag` | `feature_flag.set` |
| `platform_setting` | `platform_setting.update` |
| `legal_policy` | `legal_policy.publish` |
| `credential` | `credential.update`, `credential.rotate` |
| `admin` | `admin.invite`, `admin.deactivate`, `admin.role_change` |
| `auth` | `auth.login_rate_limited` |
| `break_glass` | `break_glass.recover_owner` |

---

## Campos proibidos em diff_before / diff_after

Nunca incluir: `value_encrypted`, `hashed_token`, qualquer campo com `password` ou `secret` no nome. Responsabilidade da RPC de ação excluir esses campos antes de construir o jsonb.

---

## Tabela de ações registradas

Atualizada por cada sprint. O `@spec-writer` appenda as ações novas no encerramento do sprint.

| action slug | target_type | sprint | descrição |
|---|---|---|---|
| *(primeiras ações no Sprint 05)* | | | |
