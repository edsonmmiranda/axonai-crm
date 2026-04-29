# Runbook — Break-glass: recuperação de owner

> **Sprint:** admin_12 · **Data:** 2026-04-28
> **Quem usa:** platform admin owner com acesso a infraestrutura crítica.
> **Quando usar:** lockout total da plataforma (último owner ativo desativado, ou todos os admins perderam MFA simultaneamente).
> **PRD:** [`docs/admin_area/admin_area_prd.md`](admin_area_prd.md) §RF-ADMIN-8 / INV-10 / G-21 / T-20.

Este procedimento **escala silenciosamente** privilégios para `owner` via CLI fora da UI admin. Toda execução grava linha em `audit_log` com `action='break_glass.recover_owner'` (defesa última contra abuso — comprometimento da double-key não impede o rastro).

---

## 1. Pré-requisitos

### 1.1 Cofres separados (obrigatório)

`SUPABASE_SERVICE_ROLE_KEY` e `BREAK_GLASS_SECRET` ficam em **cofres distintos**. Comprometer um isoladamente não dá poder de recuperação. Sugestões:

| Credencial | Cofre sugerido | Rotação |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | 1Password vault "Axon — Supabase Prod" (acesso restrito a owners) | Pós-incidente OU anual |
| `BREAK_GLASS_SECRET` | 1Password vault "Axon — Break-glass" (acesso 2-pessoas) **OU** AWS Secrets Manager separado | Trimestral, **fora-de-fase** com a service role |

**Anti-padrão:** ambos os secrets no mesmo vault ou na mesma máquina. Se isso acontecer, T-20 não está mitigado — abrir issue P0.

### 1.2 Setup inicial: seedar o hash do secret

Antes do primeiro uso, gere um secret aleatório e seede o hash em `platform_settings`. Faça **uma única vez** (e a cada rotação).

**Passo 1 — gerar secret aleatório (32 bytes hex):**

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
# Exemplo de saída: 7c4a3f2e... (anote — vai para o cofre)
```

**Passo 2 — calcular SHA-256 do secret:**

```bash
echo -n "<o-secret-do-passo-1>" | shasum -a 256 | awk '{print $1}'
# Saída: hex de 64 chars (esse é o HASH que vai pro banco)
```

**Passo 3 — seedar via Supabase Studio SQL Editor (com service role autenticado):**

```sql
-- Substituir <hash> pelo output do passo 2
SELECT public.admin_set_setting(
  p_key        => 'break_glass_secret_hash',
  p_value_type => 'text',
  p_value_text => '<hash-de-64-chars>'
);
```

**Passo 4 — armazenar o secret bruto no cofre B**, jogar fora a versão local. Nunca commit.

**Passo 5 — validar o setup:**

```sql
SELECT public.get_break_glass_secret_hash();
-- esperado: o hash que você seedou
```

### 1.3 Rotação

Mesma sequência (passos 1-4) com `admin_set_setting` chamada de novo (UPSERT — sobrescreve a row existente). Após sobrescrever no banco, atualizar o cofre B com o novo secret. Cadência sugerida: trimestral.

---

## 2. Execução

### 2.1 Ambiente

A execução acontece em uma **máquina de operador autorizado**, fora do laptop comum. Ambiente preparado:

- Repositório do projeto clonado e atualizado.
- `npm install` executado (instala `tsx` + `@supabase/supabase-js`).
- `.env.local` com as **4 variáveis obrigatórias** (puxadas dos cofres no momento do incidente, não armazenadas em texto puro entre execuções):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<vault-A>
BREAK_GLASS_SECRET=<vault-B>
BREAK_GLASS_OPERATOR=<seu-nome-ou-handle>
```

### 2.2 Comando

```bash
npm run break-glass -- <email-do-owner-a-recuperar>
# OU
npx tsx scripts/break-glass.ts <email-do-owner-a-recuperar>
```

### 2.3 Confirmação digitada

O CLI vai pedir que você digite o email **literalmente** para confirmar. Mismatch = abort sem nenhum write.

```
⚠  BREAK-GLASS: vai restaurar OWNER + invalidar MFA do profile com email 'edsonmmiranda@gmail.com'.
Operator: edson-incidente-2026-04-28

Digite o email 'edsonmmiranda@gmail.com' para confirmar:
```

### 2.4 Saída esperada (sucesso)

```
✓ MFA factors invalidated: 1/1

✓ Owner restored.
  profile_id        = c0bb904c-0939-4b66-838e-eabf23df4377
  platform_admin_id = ...
  audit_log_id      = ...
  Previous state    : was_active=false, old_role=owner

Target must complete MFA re-enroll on next /admin/login.
(Sprint 11 mfa_reset_required flag forces redirect to /admin/mfa-enroll?reenroll=true)
```

### 2.5 Validação pós-execução

Confirme via SQL no Studio:

```sql
SELECT id, action, actor_email_snapshot, occurred_at, metadata
  FROM public.audit_log
 WHERE action = 'break_glass.recover_owner'
 ORDER BY occurred_at DESC
 LIMIT 5;
```

Espere ver a linha que você acabou de criar com:
- `actor_email_snapshot` = email do alvo
- `metadata.operator` = `BREAK_GLASS_OPERATOR` que você usou
- `metadata.origin_host` = hostname da máquina onde rodou

Confirme o estado de `platform_admins`:

```sql
SELECT pa.id, pa.role, pa.is_active, p.email
  FROM public.platform_admins pa
  JOIN public.profiles p ON p.id = pa.profile_id
 WHERE p.email = 'edsonmmiranda@gmail.com';
-- esperado: role='owner', is_active=true
```

Confirme que o re-enroll está armado:

```sql
SELECT id, email, mfa_reset_required FROM public.profiles
 WHERE email = 'edsonmmiranda@gmail.com';
-- esperado: mfa_reset_required = true
```

### 2.6 Próximo login do alvo

1. Owner restaurado abre `/admin/login` e autentica com email + senha existente.
2. Middleware `requireAdminSession` (Sprint 11) lê `mfa_reset_required=true` → redireciona para `/admin/mfa-enroll?reenroll=true`.
3. Owner enrolla **novo** TOTP (factor antigo já foi deletado pelo CLI).
4. Após verify do novo TOTP, `complete_admin_mfa_reenroll` reseta o flag → acesso liberado.

---

## 3. Recuperação de erro parcial

### 3.1 RPC sucedeu, Auth Admin API falhou (deleteFactor)

**Sintoma:** CLI imprime `⚠  deleteFactor ... failed` mas RPC retornou sucesso.

**Estado:** `platform_admins` row reativada como owner; `profiles.mfa_reset_required=true`; **mas algum factor TOTP antigo ainda válido**.

**Recuperação:** rodar o **mesmo comando novamente**. RPC é idempotente (UPSERT) e Auth API também (lista de factors menor a cada iteração). Estado convergente.

### 3.2 RPC falhou (`profile_not_found`)

**Sintoma:** CLI imprime `RPC error: profile_not_found`.

**Causa:** email passado não existe em `public.profiles` (nem como customer user nem como admin).

**Recuperação:** validar email correto (case-insensitive) via SQL:

```sql
SELECT id, email FROM public.profiles WHERE lower(email) = lower('<email>');
```

Se profile não existe, **criar primeiro** via fluxo normal (não há atalho — break-glass restaura owner de profile existente, não cria profile do zero).

### 3.3 `BREAK_GLASS_SECRET hash not configured`

**Sintoma:** CLI sai com essa mensagem antes de qualquer write.

**Causa:** setup inicial (§1.2) não foi feito.

**Recuperação:** seedar conforme §1.2 e re-rodar.

### 3.4 `BREAK_GLASS_SECRET invalid`

**Sintoma:** CLI sai com essa mensagem.

**Causa:** secret no env não bate com o hash em `platform_settings`. Possíveis razões:
- Cofre B desatualizado (rotação aconteceu mas você puxou versão antiga).
- Secret foi rotacionado **e** o cofre não foi atualizado.

**Recuperação:** confirmar com outro owner qual é o secret vigente; se alinhamento confirmado mas ainda falha, reseedar o hash via §1.2 (rotação forçada).

---

## 4. Pós-incidente

Após cada execução de break-glass:

1. **Notificar manualmente** os outros owners (Slack interno / voz). Alerta automático é fase 2.
2. **Investigação:** por que o lockout aconteceu? Documentar root cause em runbook próprio do incidente.
3. **Considerar rotação** de `BREAK_GLASS_SECRET` se houver suspeita de comprometimento (ex.: laptop perdido entre o último uso e este).
4. **Audit review:** pesquisar `SELECT * FROM audit_log WHERE action='break_glass.recover_owner' ORDER BY occurred_at DESC` semanalmente — entradas inesperadas são P0.

---

## 5. Limitações conhecidas

- **Sessões existentes não são revogadas** (decisão (e) do PRD admin_12 §0). Atacante com sessão admin antiga (TTL 8h) ainda opera por até 1h até o middleware Sprint 11 forçar re-enroll. Mitigação: TTL admin reduzido (D-8). Janela de exposição máxima documentada.
- **Rate limit do break-glass não existe.** Operador legítimo pode rodar quantas vezes quiser; cada execução gera audit. Se atacante com double-key estourar 100 execuções em sequência, são 100 linhas de audit (alerta cru via SQL). Sem hard limit no MVP.
- **Bypass do CLI via SQL direto.** Quem tem service role pode executar `break_glass_recover_owner` direto via REST. Hash do secret **não é** validado pela RPC (intencional — RPC é o backend agnóstico do CLI). Defesa contra esse bypass: separação de cofres (`BREAK_GLASS_SECRET` não dá nenhum poder em SQL — é só prova de autorização do CLI). Atacante com **só** service role consegue executar a RPC e gerar audit, mas isso já é o cenário T-20 mitigado por audit obrigatório.
- **Sem revogação de break-glass.** Não existe "desfazer break-glass" automatizado. Se foi executado erroneamente, owner restaurado precisa ser desativado manualmente via UI Sprint 11 (`/admin/admins/<id>` → Desativar). Trigger Sprint 02 protege last-owner — se restaurar um único owner e tentar desativar, falha com `last_owner_protected`.

---

## 6. Checklist de auditoria (mensal)

- [ ] `SELECT count(*) FROM audit_log WHERE action='break_glass.recover_owner' AND occurred_at > now() - interval '30 days';` — esperado: 0 ou número justificado por incidente.
- [ ] Cada linha encontrada cruzada com runbook de incidente próprio.
- [ ] `BREAK_GLASS_SECRET` rotacionado dentro de 90 dias.
- [ ] Lista de pessoas com acesso ao cofre B revisada.
