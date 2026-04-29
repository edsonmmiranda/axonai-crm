# Runbook — Origin Isolation (Admin × Customer)

> **Origem:** Sprint admin_13 (RNF-SEC-1, RNF-SEC-2, T-01).
> **Owner operacional:** Edson.

A área admin é servida em hostname distinto do customer app (`admin.<host>` vs `app.<host>`/`<host>`). Hostname gate no middleware retorna 404 para combinações inválidas; cookies de sessão ficam isolados por `domain` + `SameSite=Strict`.

---

## 1. Pré-requisitos

- Acesso ao Vercel project (ou DNS provider equivalente).
- Acesso ao painel de variáveis de ambiente do deploy.
- Variáveis novas (Sprint admin_13):
  - `NEXT_PUBLIC_ADMIN_HOST` — ex.: `admin.axonai.com`
  - `NEXT_PUBLIC_CUSTOMER_HOST` — ex.: `app.axonai.com`

---

## 2. Setup inicial (primeira vez)

### 2.1 — DNS / domínios

1. Apontar ambos os hostnames para o **mesmo deployment** Next.js no Vercel:
   - `admin.<root>` → mesmo project
   - `app.<root>` → mesmo project
2. No Vercel: **Settings → Domains** → adicionar os dois domínios ao project. Confirmar SSL emitido.
3. Esperar propagação DNS (até 24h em casos extremos; tipicamente 5-15min).

### 2.2 — Validar DNS

```bash
dig +short admin.axonai.com
dig +short app.axonai.com
# Os dois devem resolver para os mesmos IPs do Vercel (cname.vercel-dns.com / similar).
```

### 2.3 — Configurar variáveis de ambiente (Vercel)

Em **Project Settings → Environment Variables** (escopo Production + Preview):

```
NEXT_PUBLIC_ADMIN_HOST=admin.axonai.com
NEXT_PUBLIC_CUSTOMER_HOST=app.axonai.com
```

> **Crítico:** ambas obrigatórias em produção. Middleware faz hard-fail 503 em qualquer `/admin/*` se ausentes.

### 2.4 — Deploy

Trigger novo deploy (push para main ou redeploy manual). Após deploy concluído, prosseguir para smoke tests.

---

## 3. Smoke tests pós-deploy

Rodar contra produção (substituir hostnames reais).

### 3.1 — Admin host serve admin

```bash
curl -sI https://admin.axonai.com/admin/login | head -1
# Esperado: HTTP/2 200 (ou 307 redirect para flow de login se já logado)
```

### 3.2 — Customer host RECUSA admin

```bash
curl -sI https://app.axonai.com/admin/login | head -1
# Esperado: HTTP/2 404
```

### 3.3 — Admin host RECUSA customer

```bash
curl -sI https://admin.axonai.com/dashboard | head -1
# Esperado: HTTP/2 404
```

### 3.4 — Customer host serve customer

```bash
curl -sI https://app.axonai.com/dashboard | head -1
# Esperado: HTTP/2 200 / 307 (depende de login)
```

### 3.5 — Cookies de sessão isolados

Após login admin em `https://admin.axonai.com/admin/login`:

```bash
# Inspecione cookies no navegador (DevTools → Application → Cookies)
# Procure por: sb-<project-ref>-auth-token (ou similar)
# Atributos esperados:
#   Domain: admin.axonai.com   (NÃO .axonai.com — sem dot prefix)
#   SameSite: Strict
#   Secure: true
```

Validar cross-context:
1. Logado em `admin.axonai.com`, navegar para `app.axonai.com` em outra aba.
2. Cookie de admin não deve aparecer no request a `app.axonai.com` (DevTools → Network → headers).
3. Login em `app.axonai.com` cria cookie separado com `Domain: app.axonai.com`.

---

## 4. Rollback (sem novo deploy)

### 4.1 — Desativar gate via env var

> ⚠️ **Não há flag `ADMIN_HOST_GATE_DISABLED` implementada.** Para desativar o gate, remover ambas as env vars:

1. Vercel **Settings → Environment Variables** → deletar `NEXT_PUBLIC_ADMIN_HOST` e `NEXT_PUBLIC_CUSTOMER_HOST`.
2. Redeploy (ou aguardar próximo deploy que carregue env atualizada).
3. Em produção, sem env vars + path `/admin/*` → middleware retorna **503** (hard-fail). **Isso bloqueia o admin completamente** — usar apenas em incidente real.

### 4.2 — Apontar admin host para nada

Como alternativa menos disruptiva:

1. No DNS: apontar `admin.axonai.com` para `NXDOMAIN` ou para uma página de manutenção estática.
2. Customer host (`app.axonai.com`) continua intacto.

### 4.3 — Reverter middleware (último recurso)

```bash
git revert <commit-hash-da-sprint-admin-13>
```

Reverte:
- Hostname gate no middleware
- Cookies isolados (volta ao default Supabase)
- Mantém migration DB intacta (pg_cron + transições continuam rodando)

---

## 5. Modo dev local

Em `localhost` ou `127.0.0.1`:
- Middleware detecta host de dev e roda em **modo permissivo** (sem gate).
- Warning único é emitido no console:
  ```
  [hostnameGate] running in dev-permissive mode — set NEXT_PUBLIC_ADMIN_HOST and NEXT_PUBLIC_CUSTOMER_HOST in production.
  ```
- Cookies em dev **não** recebem `domain` explícito (browsers descartam cookies com `domain=localhost`).

Nenhuma ação é necessária em dev — `npm run dev` funciona normalmente.

---

## 6. Troubleshooting

### Sintoma: `/admin/*` retorna 503 em produção

**Causa:** env vars `NEXT_PUBLIC_ADMIN_HOST` ou `NEXT_PUBLIC_CUSTOMER_HOST` não definidas.

**Fix:** definir ambas no Vercel + redeploy. Ver §2.3.

### Sintoma: login admin OK mas cookie não persiste

**Causa:** mismatch entre `Domain` do cookie e host atual. Pode ocorrer se deploy mudou de hostname sem atualizar env.

**Fix:**
1. Confirmar que `NEXT_PUBLIC_ADMIN_HOST` bate com o hostname do navegador.
2. Limpar cookies do site no browser e relogar.

### Sintoma: customer logado consegue ver `/admin/login`

**Causa:** request foi feito ao admin host (not customer host) — gate funcionou. Veja qual host o navegador acessou.

**Verificar:**
```bash
# Pelo navegador:
window.location.host  # → deve ser admin.axonai.com nesse caso
```

Se confirmado que veio do customer host e ainda assim serviu admin: **bug**. Reportar imediatamente — gate falhou.

### Sintoma: cron de transições parou de rodar

Não relacionado ao origin isolation. Ver `cron.job_run_details` no banco:

```sql
SELECT * FROM cron.job_run_details
WHERE jobname = 'admin_transition_subscriptions_hourly'
ORDER BY start_time DESC
LIMIT 10;
```

---

## 7. Histórico

| Data | Mudança | Quem |
|---|---|---|
| 2026-04-29 | Versão inicial — Sprint admin_13 | Edson + agentes |
