# Runbook: Configuração de MFA e Sessão Admin

> **Quando executar:** antes do primeiro deploy da área admin (Sprint 04) e em qualquer novo projeto Supabase.
> **Quem executa:** platform admin owner com acesso ao dashboard Supabase.
> **Reversível:** sim — as configurações podem ser alteradas a qualquer momento no dashboard.

---

## 1. Habilitar MFA TOTP no projeto Supabase

1. Acesse o [Supabase Dashboard](https://supabase.com/dashboard) e selecione o projeto.
2. Navegue em: **Authentication → Sign In / Up → Multi-Factor Authentication**.
3. Em **TOTP (Time-based One-time Password)**, ative o toggle **"Enable TOTP"**.
4. Salve as configurações.

**Verificação:** no console do navegador (aba da aplicação), tente chamar `supabase.auth.mfa.enroll({ factorType: 'totp' })`. Se não retornar erro `mfa_disabled`, a feature está ativa.

---

## 2. Configurar duração de sessão admin (D-8)

**Decisão fixada:** 8h de inatividade · 12h absoluta.

1. No dashboard Supabase, navegue em: **Authentication → Sessions**.
2. Configure:
   - **Inactivity timeout:** `28800` segundos (= 8h)
   - **Max session duration (absolute):** `43200` segundos (= 12h)
3. Salve as configurações.

> **Atenção:** estas configurações se aplicam a **todos** os usuários do projeto (customer + admin). Se o customer app precisar de sessões mais longas no futuro, será necessário separar os projetos Supabase (Sprint 13 — origin isolation) ou usar refresh token manual.

---

## 3. Verificar configuração aplicada

Após salvar, valide com uma sessão de teste:

1. Faça login via `/admin/login`.
2. Complete o MFA challenge.
3. Inspecione o JWT no console: `supabase.auth.getSession()` — o campo `expires_at` deve refletir ≤ 12h a partir do login.

---

## Referências

- Decisão D-8: `docs/PROJECT_CONTEXT.md` §3
- Sprint admin_04: `sprints/done/sprint_admin_04_shell_admin.md`
