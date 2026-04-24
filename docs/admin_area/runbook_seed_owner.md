# Runbook: Seed do primeiro platform admin owner

> **Sprint:** admin_02 · **Data:** 2026-04-24
> **Contexto:** executa após a migration `20260424170000_platform_admins_rbac.sql` ser aplicada em staging/prod.
> **Ferramenta:** Supabase Studio SQL Editor (precisará de acesso como `service_role`).

---

## Pré-requisitos

1. Migration Sprint 02 aplicada no banco alvo (staging **antes** de prod).
2. Acesso `service_role` via Supabase Studio → SQL Editor.
3. Profile alvo existe em `public.profiles` e está vinculado à org `slug='axon'` (passo 2 corrige se necessário).

---

## Passo 1 — Verificar org interna

```sql
SELECT id, name, slug, is_internal
FROM public.organizations
WHERE slug = 'axon';
```

Esperado: 1 linha com `is_internal = true`. Se a org não existe, o Sprint 01 não foi aplicado — **pare**.

---

## Passo 2 — Verificar onde o profile do Edson está

```sql
SELECT p.id AS profile_id, p.full_name, p.role, o.slug AS org_slug, o.is_internal, u.email
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
LEFT JOIN public.organizations o ON o.id = p.organization_id
WHERE u.email = 'edsonmmiranda@gmail.com';
```

**Se `org_slug = 'axon'` e `is_internal = true`:** pule para o Passo 3.

**Se `org_slug <> 'axon'` (ex: `'pessoal'`):** Edson está em outra org. INV-5 exige que platform admins sejam membros da org interna.

### Opções (escolha uma):

**Opção A — Mover Edson para a org `axon` (recomendada se `pessoal` é apenas dogfood/teste):**

```sql
BEGIN;

-- Anote o UUID da org axon:
-- SELECT id FROM public.organizations WHERE slug = 'axon';
-- Ex: c6d506ca-08f0-4714-b330-6eb1a11f679b

UPDATE public.profiles
SET organization_id = 'c6d506ca-08f0-4714-b330-6eb1a11f679b'
WHERE id = 'c0bb904c-0939-4b66-838e-eabf23df4377';  -- profile_id do Edson

-- Validar:
SELECT p.id, o.slug, o.is_internal
FROM public.profiles p
JOIN public.organizations o ON o.id = p.organization_id
WHERE p.id = 'c0bb904c-0939-4b66-838e-eabf23df4377';

-- Se slug='axon' e is_internal=true:
COMMIT;

-- Se não:
-- ROLLBACK;
```

⚠️ **Consequência:** após o COMMIT, Edson verá a org `axon` como seu contexto no customer app (JWT claim `organization_id` atualiza no próximo login). Dados da org `pessoal` (leads, produtos etc.) continuarão no banco mas Edson perderá acesso via RLS. Resolução: deixar a org `pessoal` com outro owner ou arquivá-la em passo separado.

**Opção B — Criar outro profile na org `axon` como primeiro owner (se Edson precisar manter acesso à `pessoal`):**
- Criar um auth user dedicado (ex: `admin@axon.ai`) via Supabase Auth console.
- Garantir que o profile resultante esteja na org `axon`.
- Usar o `profile_id` desse novo usuário no Passo 3.

---

## Passo 3 — Executar o seed

```sql
-- Substitua pelo profile_id de Edson (ou do novo owner se escolheu Opção B):
SELECT public.seed_initial_platform_admin_owner(
  'c0bb904c-0939-4b66-838e-eabf23df4377'::uuid
);
```

**Esperado:** retorna um UUID (o `id` da linha criada em `platform_admins`).

**Erro `platform_admins_already_seeded`:** tabela já tem dados. Use as RPCs do Sprint 11 para admins adicionais.

**Erro `profile_not_in_internal_org`:** profile não está na org interna — volte ao Passo 2 e execute a Opção A.

**Erro `profile_not_found`:** UUID inválido — verifique o `profile_id` com a query do Passo 2.

---

## Passo 4 — Verificação pós-seed

```sql
-- Deve retornar 1 linha com role='owner', is_active=true:
SELECT id, profile_id, role, is_active, created_at, deactivated_at
FROM public.platform_admins;

-- Deve retornar a mesma linha via RPC (teste de leitura autenticada):
-- (executar no client Supabase como service_role)
SELECT * FROM public.is_platform_admin(
  'c0bb904c-0939-4b66-838e-eabf23df4377'::uuid
);
```

---

## Passo 5 — Teste do trigger last-owner (INV-3)

```sql
-- Deve FALHAR com ERRCODE=P0001, message='last_owner_protected':
UPDATE public.platform_admins
SET is_active = false, deactivated_at = now()
WHERE profile_id = 'c0bb904c-0939-4b66-838e-eabf23df4377';

-- Deve FALHAR com o mesmo erro:
DELETE FROM public.platform_admins
WHERE profile_id = 'c0bb904c-0939-4b66-838e-eabf23df4377';
```

Se qualquer um dos dois **não** falhar, o trigger não foi aplicado. Verifique se a migration foi aplicada corretamente.

---

## Passo 6 — Desfazer o seed (emergência: profile errado)

> Use apenas se o seed foi executado com o profile_id errado e Sprint 11 ainda não existe.

O trigger last-owner bloqueia UPDATE/DELETE normais. Para contornar:

```sql
BEGIN;

-- Desabilitar triggers temporariamente (requer owner do schema ou superuser):
ALTER TABLE public.platform_admins DISABLE TRIGGER trg_platform_admins_prevent_last_owner_del;
ALTER TABLE public.platform_admins DISABLE TRIGGER trg_platform_admins_prevent_last_owner_upd;

-- Remover o seed errado:
DELETE FROM public.platform_admins;

-- Re-habilitar:
ALTER TABLE public.platform_admins ENABLE TRIGGER trg_platform_admins_prevent_last_owner_del;
ALTER TABLE public.platform_admins ENABLE TRIGGER trg_platform_admins_prevent_last_owner_upd;

COMMIT;

-- Depois: re-executar o Passo 3 com o profile_id correto.
```

⚠️ Desabilitar triggers é uma operação privilegiada. Confirme com dois olhos antes do COMMIT.
