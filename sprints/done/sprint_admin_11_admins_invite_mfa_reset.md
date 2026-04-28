# Sprint admin_11: CRUD platform admins + convite single-use + password reset com MFA re-enroll

> **Nível:** STANDARD
> **Ciclo:** Admin Area · Sprint 11 de 13
> **Plano fonte:** [`docs/admin_area/sprint_plan.md`](../../docs/admin_area/sprint_plan.md) § Sprint 11
> **PRD fonte:** [`docs/admin_area/admin_area_prd.md`](../../docs/admin_area/admin_area_prd.md) § RF-ADMIN-3, RF-ADMIN-4, RF-AUTH-7, INV-3, G-08, G-15, G-22, T-15, RNF-UX-2
> **Dependências satisfeitas:** sprint_admin_02 ✅ (`platform_admins`, `is_platform_admin`, trigger `prevent_last_owner_deactivation` cobrindo UPDATE+DELETE, helpers `requirePlatformAdmin`/`requirePlatformAdminRole`, RBAC matrix em `docs/admin_area/rbac_matrix.md`) · sprint_admin_03 ✅ (`audit_write` RPC + `writeAudit` helper) · sprint_admin_04 ✅ (shell `/admin/*`, middleware `requireAdminSession`, página `/admin/mfa-enroll` com TOTP via `supabase.auth.mfa.enroll`, AAL2 enforcement) · sprint_admin_10 ✅ (`sendEmail` + `EmailDeliveryResult` discriminado + fallback chain DB→env→offline + `email_delivery_log` com FK lógica `related_entity_type='platform_admin_invitation'` já registrado no CHECK)
> **Dependências NÃO satisfeitas (intencional):** nenhuma — este é o último sprint do ciclo admin que toca auth/identidade. Sprint 12 (audit UI + rate limit login admin + break-glass CLI) depende deste para cobrir todas as ações sensíveis no audit log.
> **Estado do banco consultado direto via MCP** — não usar `docs/schema_snapshot.json`.

---

## 🎯 Objetivo de Negócio

Fechar a malha de gestão de operadores da plataforma Axon. Hoje, depois do Sprint 02, existe **um** platform admin owner (Edson) seedado manualmente — não há caminho via UI para convidar o segundo owner, alterar papéis, desativar admins, nem para tratar reset de senha de admin com a defesa correta (re-enroll obrigatório de MFA).

Três fluxos críticos entram em produção neste sprint:

1. **CRUD de platform admins (RF-ADMIN-3)** — owner cria convite, altera papel, desativa. Trigger `prevent_last_owner_deactivation` (Sprint 02) é exercitado pela primeira vez via UI.
2. **Convite single-use (RF-ADMIN-4, G-15)** — owner gera link tokenizado; consumo é atômico (`UPDATE ... WHERE consumed_at IS NULL` em transação isolada); token expira em 72h; consumo dispara enroll obrigatório de MFA antes de qualquer rota admin liberar acesso ao recém-convidado.
3. **Password reset com MFA re-enroll (RF-AUTH-7, G-22, T-15)** — quando um platform admin completa um password reset (recuperação de senha via email), o factor TOTP existente é **invalidado** e o admin é forçado a re-enroll de MFA antes do próximo acesso à área admin. Reset de MFA de **outro admin** (cenário de admin perdeu seed TOTP) requer **step-up de aprovação dupla** entre dois owners distintos antes do flag `mfa_reset_required` ser setado.

Esta sprint **não entrega** novos primitivos de auth (todos vêm de Sprint 02 + Sprint 04) nem novos componentes de email (Sprint 10). Entrega o **fluxo end-to-end** que costura o que existe.

**Métrica de sucesso:**
- Owner consegue convidar segundo owner via UI sem SQL manual; convite chega como email transacional via `sendEmail` (Sprint 10) ou como link copiável quando o sender cai em `fallback_offline`.
- Token de convite consumido **uma vez**: segunda tentativa falha com erro tipado `'invitation_already_consumed'` (G-15) — testado via teste integrado que dispara duas chamadas em paralelo a `consumeInvitationAction` e assert que exatamente uma vence.
- Admin que completa reset de senha é forçado a re-enroll de MFA antes do `requireAdminSession()` liberar qualquer rota `/admin/*` (G-22) — verificado por teste de integração que simula o fluxo completo (`updateUser({password})` → `mark_admin_password_reset` → próxima chamada a `requireAdminSession()` redireciona para `/admin/mfa-enroll?reenroll=true`).
- Tentar desativar o último owner ativo via UI falha com erro tipado `'last_owner_protected'` — exercício do trigger Sprint 02 pela UI (G-08 revalidado).
- Reset de MFA de outro admin exige aprovação de **um segundo owner distinto** (≠ requester ≠ target) — testado via teste integrado que cobre rejeição de auto-aprovação e auto-target.
- Audit log registra cada ação: `platform_admin.invite_create`, `platform_admin.invite_consume`, `platform_admin.invite_revoke`, `platform_admin.role_change`, `platform_admin.deactivate`, `platform_admin.mfa_reset_request`, `platform_admin.mfa_reset_approve`, `platform_admin.mfa_reset_consume`, `password_reset.complete_admin`. Validação por SQL pós-teste.

---

## 👤 User Stories

- Como **platform admin owner**, quero convidar um novo membro da equipe Axon como owner/support/billing via formulário simples, para que ele receba link de aceite por email sem eu precisar manipular tabelas.
- Como **platform admin owner**, quero ver lista de admins ativos com papel, último login (via `auth.users.last_sign_in_at`) e status MFA, para conduzir auditoria rápida de quem tem acesso.
- Como **platform admin owner**, quero alterar o papel de um admin existente sem precisar desativar e re-convidar, para que mudanças de função não causem janela de acesso interrompido.
- Como **platform admin owner**, quero desativar um admin que saiu da empresa com confirmação digitada explícita, para que o acesso seja revogado imediatamente sem risco de clique acidental — e o sistema **deve** me bloquear se eu tentar desativar o último owner.
- Como **convidado novo**, quero abrir o link recebido por email, criar minha senha, configurar TOTP via app autenticador e entrar na área admin, sem precisar receber instruções manuais de setup.
- Como **platform admin owner**, quero ver convites pendentes (não consumidos, não expirados, não revogados), para reenviar manualmente o link em caso de email perdido ou para revogar um convite enviado por engano.
- Como **platform admin que perdeu o aparelho com TOTP**, quero pedir reset de MFA a outro owner (não a mim mesmo), para recuperar acesso sem depender de break-glass — sabendo que o reset só sai depois de aprovação de **um terceiro owner distinto**.
- Como **platform admin owner aprovador**, quero ver lista de pedidos de reset MFA pendentes, com motivo e quem solicitou, para aprovar ou negar com base em verificação out-of-band (ligação, Slack interno) — e o sistema **deve** me impedir de aprovar pedidos que eu mesmo abri ou pedidos cujo target seja eu.
- Como **platform admin que esqueceu a senha**, quero recuperar via fluxo padrão de email, e ao logar de volta o sistema **deve** exigir re-enroll de MFA antes de me liberar para qualquer rota admin — porque a recuperação de senha não prova posse do segundo fator.
- Como **auditor de segurança**, quero ver no audit log toda criação/revogação/consumo de convite, mudança de papel, desativação, solicitação/aprovação/consumo de reset MFA, e completion de password reset com `target_profile_id` correto, para responder "quem deu acesso a quem em quando".
- Como **customer user**, ainda não recebo nada deste sprint — fluxos são exclusivos da área admin.

---

## 🎨 Referências Visuais

- **Layout admin:** já existe — `src/app/admin/layout.tsx` + `src/components/admin/AdminShell.tsx`. Sprint adiciona rotas novas sob `/admin/admins` e a página pública (não-admin) `/admin/accept-invite/[token]`.
- **Página `/admin/admins` (lista):** padrão de listagem do Sprint 09 (settings) e Sprint 05 (organizations). Tabs no topo:
  - **Admins ativos** (default) — tabela com nome, email, papel (badge), data de criação, último login (relativo: "há 2h"), status MFA ("Configurado" / "Pendente"). Linhas clicáveis → detalhe.
  - **Convites pendentes** — email, papel, gerado por, criado em, expira em (relativo: "em 23h"). Ações: copiar link, revogar.
  - **Solicitações de reset MFA** — admin alvo, solicitado por, motivo, status (Pendente / Aprovada / Consumida / Expirada), expira em. Ações: aprovar (se pendente e caller é owner ≠ requester ≠ target), revogar.
- **Página `/admin/admins/invite` (form de convite):** formulário simples (1 coluna): `email`, `role` (select: owner/support/billing), botão "Enviar convite". Após submit, mostra estado:
  - Email enviado: toast "Convite enviado para X" + link para detalhe do convite.
  - Fallback offline (Sprint 10 retornou `status: 'fallback_offline'`): banner persistente "Email não configurado — copie o link abaixo e envie manualmente:" + input read-only com `offlineLink` + botão "Copiar".
- **Página `/admin/admins/[id]` (detalhe do admin):** card com dados (foto, nome, email, papel atual), seção "Ações" com botões:
  - Mudar papel (dialog com select)
  - Desativar (dialog com confirmação digitada do email — RNF-UX-2)
  - Solicitar reset de MFA (dialog com motivo obrigatório, mín. 5 chars; **escondido** se caller é o próprio admin alvo)
- **Página `/admin/accept-invite/[token]` (pública):** fluxo de 3 passos verticais:
  1. **Validação do token** (server-side antes de renderizar): expirado → tela "Convite expirado, peça novo ao admin que te convidou"; revogado → "Convite revogado"; consumido → "Convite já utilizado"; OK → renderiza passo 2.
  2. **Criar conta ou logar** (form: email pré-preenchido e disabled, senha + confirmação OU "já tenho conta" → login). Email do form **deve** bater com `email` do convite (server-side check).
  3. **Configurar MFA** (TOTP) — reutiliza componente do Sprint 04 `MfaEnrollForm` em modo "primeiro enroll para platform admin"; ao completar, marca `consumed_at` na invitation e cria a linha em `platform_admins` na mesma transação. Redireciona para `/admin/dashboard`.
- **Página `/admin/mfa-enroll?reenroll=true` (variante post-reset):** mesma página do Sprint 04, com banner topo "Sua sessão exige reconfiguração de MFA antes de continuar — siga os passos abaixo". Ao completar, chama `completeAdminMfaReenrollAction` que invalida factor antigo + seta `mfa_reset_required=false` + libera navegação. Sem essa página, o middleware redireciona em loop até o re-enroll ser concluído.
- **Componentes do design system a reutilizar:** `Button` (variants `primary`/`secondary`/`danger`), `Input`, `Label`, `Select`, `Dialog`, `Tabs`, `Card`, `Badge`, `Alert`/banner, `Skeleton`, `Toast`. **APRENDIZADOS 2026-04-21 e 2026-04-20** alertam sobre repetir botão inline em vez de `<Button variant="danger">` — Guardian valida via grep no GATE 4.

---

## 🧬 Reference Module Compliance

**Parcialmente aplicável.**

1. **Padrão de RPC com audit transacional + Server Action wrapper admin:** Sprints 05/06/07/09/10 são gold standard — copiar literalmente:
   - Header de RPC com `SECURITY DEFINER`, `SET search_path = public`, `REVOKE EXECUTE FROM public, anon` explícito (APRENDIZADOS 2026-04-24 — `REVOKE FROM public` não cobre `anon`).
   - Validação `requirePlatformAdminRole(['owner'])` em mutations; `requirePlatformAdmin()` em reads sem role check.
   - `audit_write(...)` na mesma transação do mutation.
   - Mapeamento de erro tipado em `actions/*.schemas.ts` → `actions/*.ts` usando o helper de narrowing tipado de `PostgrestError` (APRENDIZADOS 2026-04-26 — `error instanceof Error` é falso para `PostgrestError`).

2. **Padrão de single-use atômico:** `public.invitations` (customer app, criada antes do ciclo admin) é a referência exata — campos `token uuid UNIQUE`, `accepted_at timestamptz NULL`, consumo via `UPDATE ... SET accepted_at=now() WHERE token=$1 AND accepted_at IS NULL RETURNING *` em transação isolada (`READ COMMITTED` é suficiente porque o filtro no `WHERE` + a primary key garantem que apenas uma transação muda a linha).
   - **Trocar:** nome da coluna (`accepted_at` → `consumed_at` para alinhar com o domínio admin), adicionar `expires_at` e `revoked_at`, adicionar UNIQUE parcial em `(lower(email)) WHERE consumed_at IS NULL AND revoked_at IS NULL` (impede dois convites pendentes para o mesmo email).
   - **NÃO copiar:** o `organization_id` da invitations customer — `platform_admin_invitations` é catálogo global da plataforma, escopado à org interna via convenção (admin recém-criado vai sempre para org `slug='axon'`).

3. **Padrão de UI admin com lista + form + dialog:** Sprint 05 (`/admin/organizations`) é gold standard. Tabs (admins/convites/resets) é um padrão menor — Sprint 04 não tem tabs, então o spec valida componente Tabs do design system existente (`Tabs` do shadcn/Radix está no catálogo).

4. **Padrão de MFA enroll:** Sprint 04 entregou `src/app/admin/mfa-enroll/page.tsx` + componente `MfaEnrollForm`. Sprint 11 reutiliza:
   - Para **primeiro enroll** (convite consumido): mesmo componente, sem flag re-enroll.
   - Para **re-enroll pós-reset**: mesmo componente + banner + chamada a `completeAdminMfaReenrollAction` ao invés do callback genérico.
   - Spec valida se `MfaEnrollForm` aceita prop `mode: 'first' | 'reenroll'` ou se cria componente irmão `MfaReenrollForm`. Recomendação: prop `mode` para evitar duplicação.

5. **Sem reference module direto** para:
   - **Step-up duplo** (request + aprovação por owner distinto + consumo). Spec define o modelo: tabela `platform_admin_mfa_reset_requests` com CHECKs de distinção entre requester/approver/target, RPC de aprovação que valida tudo de novo (defesa em profundidade contra bypass via service_role direto), expiração em 24h sem aprovação.
   - **Hook de password reset que detecta platform admin e seta flag.** Spec decide se é Server Action wrapper (`completeAdminPasswordResetAction`) chamado pela página `/admin/reset-password`, ou Auth Hook em `auth.users` UPDATE de password (mais frágil — Supabase Auth Hooks tem semântica específica). Recomendação: Server Action wrapper (precedente: `Sprint 04 MFA enroll também é Server Action`).

**O que copiar:** estrutura de RPC com audit (Sprint 05/06/09/10), padrão single-use atômico (`invitations` customer), padrão UI lista+form+dialog (Sprint 05), `MfaEnrollForm` (Sprint 04).
**O que trocar:** tabelas alvo (`platform_admin_invitations`, `platform_admin_mfa_reset_requests`), schemas Zod específicos do domínio admin, action slugs do audit, fluxo de 3 passos da página de aceite.
**O que NÃO copiar:** lógica de `organization_id` da invitations customer (admin é catálogo global) nem o fluxo de password reset do customer app (`/forgot-password` → `auth.resetPasswordForEmail`) sem o wrapper de detecção de platform admin — caller direto deixaria o flag `mfa_reset_required` não-setado.

---

## 📋 Funcionalidades (Escopo)

### Backend

#### Banco de dados (autor: `@db-admin`)

> **Pré-requisito:** o sprint depende de uma única coluna nova em `profiles` (`mfa_reset_required`) e duas tabelas globais novas (`platform_admin_invitations`, `platform_admin_mfa_reset_requests`). Sem alteração em `auth.*` — Sprint 04 já validou que `auth.mfa_factors` é o suficiente.

- [ ] **Coluna nova `profiles.mfa_reset_required boolean NOT NULL DEFAULT false`**:
  - Setada por RPC `mark_admin_password_reset(p_profile_id)` (service-role only).
  - Lida pelo middleware `requireAdminSession` (Sprint 04) — modificação **mínima** desse middleware: se `mfa_reset_required=true`, redireciona para `/admin/mfa-enroll?reenroll=true` antes de servir qualquer rota admin (exceto a própria `/admin/mfa-enroll` e `/admin/login`).
  - Resetada por RPC `complete_admin_mfa_reenroll(p_profile_id)` chamada após `auth.mfa.enroll/verify` validar TOTP novo na mesma transação.
  - **Sem audit nessa coluna** — a setagem audita via `password_reset.complete_admin`, e a resetagem via `platform_admin.mfa_reset_consume`. Coluna é só state machine.

- [ ] **Tabela `platform_admin_invitations`** (FORCE RLS):
  - Colunas:
    - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
    - `email text NOT NULL CHECK (length(email) BETWEEN 3 AND 320 AND email = lower(email))` — armazenado lowercased; comparações case-insensitive consistentes.
    - `role text NOT NULL CHECK (role IN ('owner','support','billing'))` — mesmos 3 papéis de `platform_admins`.
    - `token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid()` — opaco, single-use.
    - `expires_at timestamptz NOT NULL` — default `now() + interval '72 hours'` setado no INSERT do RPC; CHECK constraint inline (`expires_at > created_at`).
    - `consumed_at timestamptz NULL` — preenchido na transação de consumo.
    - `consumed_by_profile_id uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT` — id do profile criado/identificado no consumo. NULL enquanto pendente.
    - `revoked_at timestamptz NULL` — soft-revoke pelo owner emissor.
    - `revoked_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL`.
    - `created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT`.
    - `created_at timestamptz NOT NULL DEFAULT now()`.
    - `email_delivery_log_id uuid NULL` — FK lógica para `email_delivery_log.id` (Sprint 10). NÃO declarada como FK física para preservar idempotência da migration; convenção documentada.
  - **CHECK de coerência:**
    - `(consumed_at IS NULL AND consumed_by_profile_id IS NULL) OR (consumed_at IS NOT NULL AND consumed_by_profile_id IS NOT NULL)` — consumo é atômico: ou ambos null, ou ambos preenchidos.
    - `(revoked_at IS NULL AND revoked_by IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)`.
    - `NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL)` — não pode estar em ambos os estados.
  - **UNIQUE parcial** em `(lower(email)) WHERE consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()` — impede dois convites pendentes ativos para o mesmo email.
  - Índices: `(email)`, `(expires_at)`, `(created_by, created_at DESC)`.
  - **FORCE RLS.** Policies:
    - SELECT: `is_platform_admin(auth.uid())` retorna não-null (qualquer platform admin ativo lê todos os convites).
    - **Sem policies de mutação** — writes via RPCs `SECURITY DEFINER`. SELECT do **convidado anônimo** durante o fluxo de aceite roda via service client (Server Action `getInvitationByTokenAction` — token UUID é prova de portador suficiente para ler apenas a row do convite).

- [ ] **Tabela `platform_admin_mfa_reset_requests`** (FORCE RLS):
  - Colunas:
    - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
    - `target_platform_admin_id uuid NOT NULL REFERENCES public.platform_admins(id) ON DELETE RESTRICT`
    - `target_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT` — denormalização para CHECKs (evita join no constraint).
    - `requested_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT`
    - `reason text NOT NULL CHECK (length(reason) BETWEEN 5 AND 500)`
    - `requested_at timestamptz NOT NULL DEFAULT now()`
    - `expires_at timestamptz NOT NULL` — default `now() + interval '24 hours'`. Após expirar sem aprovação, request fica órfã (não é deletada — auditoria preserva).
    - `approved_by uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT`
    - `approved_at timestamptz NULL`
    - `consumed_at timestamptz NULL` — preenchido quando o target completa re-enroll.
    - `revoked_at timestamptz NULL` — admin pode revogar request pendente sua.
    - `revoked_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL`
  - **CHECK críticos** (defesa em profundidade — mesmas regras validadas pelo RPC, repetidas no constraint para impedir bypass via service_role):
    - `requested_by <> target_profile_id` — auto-solicitação proibida.
    - `(approved_by IS NULL) OR (approved_by <> requested_by AND approved_by <> target_profile_id)` — aprovador distinto de requester e target.
    - `(approved_at IS NULL AND approved_by IS NULL) OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)`.
    - `(consumed_at IS NULL) OR (consumed_at IS NOT NULL AND approved_at IS NOT NULL)` — consumo só após aprovação.
    - `(revoked_at IS NULL AND revoked_by IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)`.
    - `NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL)`.
  - **UNIQUE parcial** em `(target_platform_admin_id) WHERE consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()` — uma única request pendente ativa por target. Spec valida (alternativa: permitir múltiplas, exigir disambiguation no consume — mas inflar; recomendação UNIQUE parcial é mais simples).
  - Índices: `(target_platform_admin_id)`, `(requested_by, requested_at DESC)`, `(approved_by) WHERE approved_at IS NOT NULL`.
  - **FORCE RLS.** Policies:
    - SELECT: qualquer platform admin ativo lê (lista de pedidos pendentes é informação operacional do time Axon).
    - Sem policies de mutação — writes via RPCs.

- [ ] **Atualizar tabela `Exceções em public.*`** em [`docs/conventions/standards.md`](../../docs/conventions/standards.md) e [`docs/PROJECT_CONTEXT.md`](../../docs/PROJECT_CONTEXT.md) §2: adicionar linhas para `platform_admin_invitations` e `platform_admin_mfa_reset_requests` com justificativa (catálogo da plataforma admin, escopado à org interna via convenção) e proteção compensatória (FORCE RLS + sem policies de mutação + writes via RPC SECURITY DEFINER).

- [ ] **RPCs (todas `SECURITY DEFINER`, `SET search_path = public`, audit dentro da mesma transação quando aplicável; REVOKE explícito de `public`, `anon` em todas conforme APRENDIZADOS 2026-04-24):**

  - `admin_create_platform_admin_invitation(p_email text, p_role text)` — **owner-only** (RPC re-valida via `is_platform_admin(auth.uid())` retorna `role='owner'`). Validações:
    - `p_email` lowercased e match regex de email simples (`~ '^[^@]+@[^@]+\\.[^@]+$'`).
    - `p_role IN ('owner','support','billing')`.
    - Não existe linha em `platform_admins` com profile cujo email = `p_email` E `is_active=true` → erro tipado `'email_already_active_admin'`.
    - Não existe convite pendente ativo para o mesmo email (UNIQUE parcial enforça mas RPC traduz para `'invitation_already_pending'`).
    - INSERT em `platform_admin_invitations` com `expires_at = now() + interval '72 hours'`.
    - `audit_write('platform_admin.invite_create', 'platform_admin_invitation', new.id, NULL, NULL, jsonb_build_object('email', p_email, 'role', p_role, 'expires_at', new.expires_at), p_metadata)`.
    - Retorna a row completa (Server Action depois envia o email com `sendEmail`).

  - `admin_revoke_platform_admin_invitation(p_id uuid)` — owner-only. UPDATE com `revoked_at = now()`, `revoked_by = auth.uid()` apenas se `consumed_at IS NULL AND revoked_at IS NULL`. Se a linha já foi consumida ou revogada, retorna erro tipado. Audit `platform_admin.invite_revoke`.

  - `admin_consume_platform_admin_invitation(p_token uuid, p_consumer_profile_id uuid)` — service-role only (chamada pela Server Action `consumeInvitationAction` após verificar identidade do consumidor via `auth.uid()`). Atômico:
    - `UPDATE platform_admin_invitations SET consumed_at = now(), consumed_by_profile_id = p_consumer_profile_id WHERE token = p_token AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING *` — se 0 rows, classifica o motivo via SELECT auxiliar (expirado/consumido/revogado) e raise erro tipado.
    - Após UPDATE bem-sucedido: INSERT em `platform_admins (profile_id=p_consumer_profile_id, role=row.role, is_active=true, created_by=invitation.created_by)`. Trigger Sprint 02 valida que `p_consumer_profile_id` está em org interna `is_internal=true` — Server Action garante isso ao criar/identificar o profile.
    - `audit_write('platform_admin.invite_consume', 'platform_admin', new_admin.id, NULL, NULL, jsonb_build_object('invitation_id', p_token, 'role', row.role, 'consumer_email', consumer_email), metadata)`.
    - Retorna a nova linha de `platform_admins`.

  - `admin_change_platform_admin_role(p_target_id uuid, p_new_role text)` — owner-only. Valida `p_new_role IN ('owner','support','billing')` e que linha alvo está ativa. UPDATE de `role`. Trigger Sprint 02 cobre downgrade do último owner (se `OLD.role='owner'` e UPDATE deixa zero owners ativos restantes, raise `last_owner_protected`). Audit `platform_admin.role_change` com diff `{role_before, role_after}`.

  - `admin_deactivate_platform_admin(p_target_id uuid)` — owner-only. UPDATE `is_active=false`, `deactivated_at=now()` apenas se row está ativa. Trigger Sprint 02 cobre last-owner. Audit `platform_admin.deactivate`. **Nota:** este sprint **não** entrega "reativar admin" — desativação é terminal no MVP; reativar exige novo convite. Spec valida.

  - `admin_request_mfa_reset(p_target_admin_id uuid, p_reason text)` — owner-only. Validações em ordem:
    - `requested_by = auth.uid() <> target_profile_id` (resolve target via JOIN com `platform_admins.profile_id`).
    - Não existe request pendente ativa para o target (UNIQUE parcial; RPC traduz para `'mfa_reset_already_pending'`).
    - INSERT com `expires_at = now() + interval '24 hours'`.
    - Audit `platform_admin.mfa_reset_request` com `metadata={target_admin_id, reason}`.

  - `admin_approve_mfa_reset(p_request_id uuid)` — owner-only. Validações:
    - `auth.uid() <> requested_by` (linha alvo).
    - `auth.uid() <> target_profile_id` (linha alvo).
    - Linha está pendente (`approved_at IS NULL AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()`).
    - UPDATE `approved_by = auth.uid()`, `approved_at = now()`. **Na mesma transação:** chama `mark_admin_password_reset(target_profile_id)` para setar `profiles.mfa_reset_required=true` (justificativa: aprovação de reset MFA = invalidação imediata do TOTP atual; target é forçado a re-enroll no próximo acesso admin).
    - Audit `platform_admin.mfa_reset_approve`.

  - `admin_revoke_mfa_reset_request(p_request_id uuid)` — qualquer platform admin owner pode revogar request pendente (não só o requester). Útil para cancelar um pedido que mudou de contexto out-of-band. UPDATE `revoked_at`, `revoked_by`. Audit `platform_admin.mfa_reset_revoke`.

  - `consume_admin_mfa_reset(p_request_id uuid, p_target_profile_id uuid)` — service-role only (chamada pelo `completeAdminMfaReenrollAction` após `auth.mfa.enroll/verify` retornar OK). Validações:
    - Linha está aprovada e não consumida nem revogada nem expirada.
    - `target_profile_id = p_target_profile_id` (defesa contra confusão de id).
    - UPDATE `consumed_at = now()`. **Na mesma transação:** UPDATE `profiles.mfa_reset_required = false` para o target.
    - **Não toca em `auth.mfa_factors` diretamente** — Server Action faz `auth.mfa.unenroll(old_factor_id)` antes/depois de `auth.mfa.enroll(new_factor)` via Supabase Auth API. RPC só lida com state da plataforma.
    - Audit `platform_admin.mfa_reset_consume`.

  - `mark_admin_password_reset(p_profile_id uuid)` — service-role only (chamada pelo `completeAdminPasswordResetAction` após `auth.updateUser({password})` confirmar). UPDATE `profiles.mfa_reset_required=true` apenas se `is_platform_admin(p_profile_id)` retorna não-null (no-op silencioso para customer users). Audit `password_reset.complete_admin` com `target_profile_id`.

  - `complete_admin_mfa_reenroll(p_profile_id uuid)` — service-role only. UPDATE `profiles.mfa_reset_required=false`. Diferente do consume MFA reset (que tem que casar com uma request existente), este é o caminho "self-service" quando o admin completa re-enroll após password reset (sem ter passado por step-up de outro admin). Audit `password_reset.mfa_reenroll_complete`.

  - `admin_list_platform_admins()` — qualquer platform admin lê. JOIN com `profiles` para nome+email+avatar+último login (via `auth.users.last_sign_in_at`); JOIN com `auth.mfa_factors` para status MFA.

  - `admin_list_platform_admin_invitations(p_filter text DEFAULT 'pending')` — qualquer platform admin lê. Filtro `'pending'` (não consumido, não revogado, não expirado), `'all'` (tudo), `'expired'` etc.

  - `admin_list_mfa_reset_requests(p_filter text DEFAULT 'pending')` — qualquer platform admin lê.

  - `get_invitation_by_token(p_token uuid)` — service-role only (chamada antes do convidado autenticar para validar o token). Retorna `(email, role, expires_at, consumed_at, revoked_at)` — **sem expor `id`** nem `created_by` para anônimo. Server Action wrappa.

- [ ] **Migration idempotente** com `IF NOT EXISTS` em todas as tabelas/policies/colunas. Header documenta as 2 tabelas novas, 1 coluna nova em `profiles`, 12 RPCs, e dependência declarada em Sprints 02/03/04/10.

#### Server Actions e helpers (autor: `@backend`)

- [ ] **`src/lib/actions/admin/platform-admins.ts`** + `.schemas.ts` — Server Actions de CRUD admin:
  - `listPlatformAdminsAction()` — read; chama `admin_list_platform_admins`.
  - `createInvitationAction({ email, role })` — owner-only.
    1. Chama `admin_create_platform_admin_invitation` RPC.
    2. Constrói `offlineLink = appUrl + '/admin/accept-invite/' + token` (caller passa pré-construído ao sender — convenção fixada no Sprint 10).
    3. Chama `sendEmail({ kind: 'invitation', to: email, subject: 'Convite Axon Admin', html, text, related: { type: 'platform_admin_invitation', id: invitation.id } })`.
    4. Atualiza `email_delivery_log_id` da invitation com o `deliveryLogId` retornado (UPDATE direto via service client; tabela tem RLS mas service_role bypass; OU adicionar RPC dedicada — spec define).
    5. Retorna `{ invitation, deliveryStatus: 'sent' | 'fallback_offline' | 'error', offlineLink? }` — UI do form decide o que mostrar.
  - `revokeInvitationAction({ id })` — owner-only.
  - `getInvitationByTokenAction(token)` — sem auth check (token é prova de portador). Retorna `{ email, role, expiresAt, status: 'valid' | 'expired' | 'consumed' | 'revoked' }`. Usado pela página de aceite.
  - `consumeInvitationAction({ token, password })` — chamada pela página de aceite após o convidado autenticar/criar conta.
    1. Server-side: cria conta via `supabase.auth.admin.createUser({ email: invitation.email, password, email_confirm: true })` se não existe; se existe e não bate com email do convite → erro tipado `email_mismatch`.
    2. Cria/atualiza profile linkado à org `slug='axon'` (movimento de profile pode exigir UPDATE manual conforme runbook Sprint 02 OP-1; spec valida se aceite cria profile automaticamente em org axon ou se há etapa pré).
    3. Chama `admin_consume_platform_admin_invitation(token, profile.id)` RPC.
    4. Retorna `{ profileId, redirectTo: '/admin/mfa-enroll?firstEnroll=true' }` — UI redireciona.
  - `changePlatformAdminRoleAction({ id, newRole })` — owner-only.
  - `deactivatePlatformAdminAction({ id, confirmEmail })` — owner-only. Server-side compara `confirmEmail` com email do target (RNF-UX-2 — confirmação digitada).
  - `requestMfaResetAction({ targetAdminId, reason })` — owner-only.
  - `approveMfaResetAction({ requestId })` — owner-only. RPC valida ≠ requester ≠ target.
  - `revokeMfaResetRequestAction({ requestId })` — owner-only.

- [ ] **`src/lib/actions/admin/admin-auth.ts`** — Server Actions de auth admin (separadas do CRUD por escopo):
  - `completeAdminPasswordResetAction({ newPassword })` — chamada pela página `/admin/reset-password/[token]` após validação do token de reset.
    1. `supabase.auth.updateUser({ password: newPassword })` — atualiza senha.
    2. Se sucesso, chama `mark_admin_password_reset(profile.id)` RPC — RPC checa internamente se profile é platform admin (no-op para customer).
    3. Retorna sucesso. UI redireciona para `/admin/login`.
  - `completeAdminMfaReenrollAction({ newFactorVerification })` — chamada pela página `/admin/mfa-enroll?reenroll=true` após o usuário verificar o novo TOTP.
    1. `supabase.auth.mfa.enroll(...)` + `supabase.auth.mfa.challenge` + `supabase.auth.mfa.verify` — fluxo padrão Supabase.
    2. Após verify OK: `supabase.auth.mfa.unenroll(oldFactorId)` para invalidar o TOTP antigo.
    3. Se há `mfa_reset_request` pendente para este admin (`consume_admin_mfa_reset` retorna não-vazio), chama RPC. Senão, chama `complete_admin_mfa_reenroll(profile.id)` RPC.
    4. Retorna sucesso. UI redireciona para `/admin/dashboard`.

- [ ] **Modificação mínima de `src/lib/auth/requireAdminSession.ts`** (Sprint 04):
  - Após validar `is_platform_admin` e AAL2, **adicionar** check: `if (profile.mfa_reset_required && currentPath !== '/admin/mfa-enroll' && currentPath !== '/admin/login') redirect('/admin/mfa-enroll?reenroll=true')`.
  - Spec valida se a checagem é via JOIN no `is_platform_admin` ou query separada (preferência: JOIN para evitar 2 round-trips por request).

- [ ] **Templates de email** (`src/lib/email/templates/`):
  - `admin-invitation.tsx` (ou `.ts` simples — spec valida) — gera HTML+text para convite. Variáveis: `{ inviterName, role, acceptUrl, expiresAt }`. Usa apenas tags HTML básicas (compatibilidade com clients de email).

- [ ] **Server-only enforcement:** `import 'server-only'` no topo de todos os helpers em `src/lib/actions/admin/admin-auth.ts` e nas templates.

#### Integration tests (autor: `@qa-integration`)

> **Cobertura mínima:** ~40 testes distribuídos em 3 arquivos. Spec valida divisão.

- [ ] **`tests/integration/admin-platform-admins.test.ts`** (mín. 18 testes):
  - `createInvitationAction`:
    - happy owner: cria invitation, audit gravado, sender chamado com payload correto, retorno inclui `deliveryStatus`.
    - RBAC: support e billing falham com `'forbidden'`.
    - Zod fail: email inválido, role fora do enum, email muito longo.
    - Email já é admin ativo → `'email_already_active_admin'`.
    - Convite duplicado pendente → `'invitation_already_pending'`.
    - Sender em fallback offline → retorno tem `offlineLink` e `deliveryStatus='fallback_offline'`.
  - `revokeInvitationAction`:
    - happy: cria → revoga → próxima consulta lista filtra fora.
    - Idempotência: revoga já-revogado → erro tipado.
    - Revoga após consumo → erro tipado.
  - `consumeInvitationAction`:
    - happy: cria invitation → consume com profile válido em org axon → linha em `platform_admins` criada, audit gravado.
    - **G-15 (single-use)**: 2 chamadas concorrentes a `consumeInvitationAction` com o mesmo token via `Promise.all` — exatamente 1 vence, outra recebe `'invitation_already_consumed'`. Asserta via SELECT `count(*) = 1` em `platform_admins` filtered.
    - Token expirado → `'invitation_expired'`.
    - Token revogado → `'invitation_revoked'`.
    - Email do consumer ≠ email do invitation → `'email_mismatch'`.
    - Profile não está em org interna → trigger Sprint 02 dispara → `'profile_not_in_internal_org'`.
  - `changePlatformAdminRoleAction`:
    - happy: muda support → billing, audit com diff.
    - **G-08**: tenta downgrade do último owner (`owner` → `support`) → `'last_owner_protected'`.
    - RBAC: non-owner falha.
  - `deactivatePlatformAdminAction`:
    - happy: desativa support; trigger Sprint 02 não interfere (não era o último owner).
    - **G-08**: tenta desativar último owner → `'last_owner_protected'`.
    - `confirmEmail` mismatch → `'confirm_email_mismatch'`.

- [ ] **`tests/integration/admin-mfa-reset.test.ts`** (mín. 14 testes):
  - `requestMfaResetAction`:
    - happy: owner A solicita reset para owner B com motivo válido.
    - Auto-solicitação: A solicita reset de A → `'self_request_forbidden'`.
    - Razão muito curta (< 5 chars) → Zod fail.
    - Pedido duplicado pendente para mesmo target → `'mfa_reset_already_pending'`.
    - RBAC: support solicita → `'forbidden'`.
  - `approveMfaResetAction`:
    - happy: owner A pede, owner C aprova → request marcada aprovada, `profiles.mfa_reset_required=true` para B.
    - Auto-aprovação: A pede, A aprova → `'self_approve_forbidden'`.
    - Target aprova: A pede para B, B aprova → `'target_approve_forbidden'`.
    - Request expirada (> 24h) → `'mfa_reset_request_expired'`.
    - Request já aprovada → `'mfa_reset_already_approved'`.
    - RBAC: support tenta aprovar → `'forbidden'`.
  - `consumeAdminMfaReset` (via `completeAdminMfaReenrollAction`):
    - happy: B (após aprovação) abre `/admin/mfa-enroll?reenroll=true` → completa enroll novo → request marcada consumida, `mfa_reset_required=false`, factor antigo invalidado (mock do `auth.mfa.unenroll`).
    - Sem request aprovada (B caiu em re-enroll por password reset apenas, sem step-up): `complete_admin_mfa_reenroll` zera `mfa_reset_required` sem tocar em `mfa_reset_requests`.

- [ ] **`tests/integration/admin-auth-password-reset.test.ts`** (mín. 8 testes):
  - `completeAdminPasswordResetAction`:
    - happy: admin reset de senha → `mark_admin_password_reset` chamado → `mfa_reset_required=true` para esse profile.
    - Customer user (não-admin) reset → `mark_admin_password_reset` retorna no-op (sem flag setado).
    - **G-22 fluxo end-to-end**: simular admin pós-reset entra em `requireAdminSession()` → assert que retorna redirect `/admin/mfa-enroll?reenroll=true` (mock do middleware).
    - Admin completa reenroll → `requireAdminSession()` libera próxima request.
    - Audit `password_reset.complete_admin` gravado com `target_profile_id` correto.

- [ ] Mock central via `tests/setup.ts` `__mockSupabase`. Mock do `supabase.auth.mfa.{enroll,verify,challenge,unenroll}` via `vi.mock`. Mock de `sendEmail` (Sprint 10) via `vi.mock('@/lib/email/sender')`. Sem `it.skip`.

### Frontend (autor: `@frontend+`)

- [ ] **Rota nova:** `src/app/admin/admins/page.tsx` (lista com tabs)
  - Server Component: chama `listPlatformAdminsAction`, `admin_list_platform_admin_invitations({filter:'pending'})`, `admin_list_mfa_reset_requests({filter:'pending'})` em paralelo.
  - Renderiza componente `<AdminsTabs>` Client Component.
  - Empty state, skeleton, error.

- [ ] **Rota nova:** `src/app/admin/admins/invite/page.tsx` (form de convite)
  - Server Component: gate de owner; renderiza `<InviteAdminForm>`.

- [ ] **Rota nova:** `src/app/admin/admins/[id]/page.tsx` (detalhe)
  - Server Component: gate de owner para ações; renderiza dados + dialogs.

- [ ] **Rota nova pública:** `src/app/admin/accept-invite/[token]/page.tsx`
  - **Não usa** `requireAdminSession` (rota pública).
  - Server Component: chama `getInvitationByTokenAction(token)`. Renderiza um dos 4 estados: válido / expirado / consumido / revogado.
  - Para válido: renderiza `<AcceptInviteFlow>` Client Component com props `{ email, role, token }`.

- [ ] **Modificação `src/app/admin/mfa-enroll/page.tsx`** (Sprint 04):
  - Detecta query param `?reenroll=true` e `?firstEnroll=true`.
  - Se `reenroll=true`: banner topo "Sua sessão exige reconfiguração de MFA antes de continuar." Componente `<MfaEnrollForm mode="reenroll">` chama `completeAdminMfaReenrollAction` no submit.
  - Se `firstEnroll=true` (vindo de aceite): título "Configure MFA para entrar na área admin". Mesmo componente, `mode="first"`, chama action diferente (`completeAdminMfaReenrollAction` aqui não se aplica — é "first enroll", já chamado dentro de `consumeInvitationAction`? — spec valida fluxo exato).

- [ ] **Componentes em `src/components/admin/admins/`:**
  - `AdminsTabs.tsx` — Client Component com tabs (Admins ativos | Convites pendentes | Pedidos de reset MFA). Reutiliza `Tabs` do design system.
  - `AdminsList.tsx` — Server Component renderiza tabela.
  - `InvitationsList.tsx` — Server Component.
  - `MfaResetRequestsList.tsx` — Server Component.
  - `InviteAdminForm.tsx` — Client Component com `react-hook-form` + `zodResolver`.
  - `AdminDetailCard.tsx` — Server Component.
  - `ChangeRoleDialog.tsx` — Client Component.
  - `DeactivateAdminDialog.tsx` — Client Component (confirmação digitada do email).
  - `RequestMfaResetDialog.tsx` — Client Component.
  - `ApproveMfaResetDialog.tsx` — Client Component.
  - `AcceptInviteFlow.tsx` — Client Component (3 passos: criar conta → MFA enroll → redirect).

- [ ] **Update do `AdminSidebar.tsx`** (Sprint 04, modificado em Sprint 09 e 10):
  - Adicionar item raiz "Administradores" com sub-itens "Lista" e "Convites pendentes" — ou item único `/admin/admins` (a página tem tabs internas, talvez mais simples). Spec decide.
  - Visibilidade: todos os papéis veem o item (suporte/billing veem em modo read-only); apenas owner vê botões de mutação.

- [ ] **Acessibilidade:** form com `aria-required`, dialogs com `role="dialog"` + foco trap (Radix gratuito), skip-link na página pública de aceite (anônimos podem usar leitor de tela).

---

## 🧪 Edge Cases (obrigatório)

- [ ] **Consumo duplo do mesmo token (G-15)**: 2 requests simultâneas a `consumeInvitationAction` com o mesmo token → 1 vence, outra falha com `'invitation_already_consumed'`. Validado por teste com `Promise.all`.
- [ ] **Token expirado (> 72h)**: página de aceite renderiza estado "expirado" sem expor o email.
- [ ] **Token revogado pelo owner antes do consumo**: página renderiza "revogado".
- [ ] **Convite enviado mas email caiu em offline_fallback (Sprint 10)**: form do owner mostra `offlineLink` para copiar manualmente; log de email registra `source='offline_fallback'`; convite continua válido por 72h.
- [ ] **Convidar email que JÁ é platform admin ativo**: RPC retorna `'email_already_active_admin'`; UI mostra mensagem clara apontando para o admin existente.
- [ ] **Convidar email que TEM outro convite pendente ativo**: UNIQUE parcial enforça; RPC traduz para `'invitation_already_pending'`; UI sugere "revogue o convite anterior antes de criar novo".
- [ ] **Convidado abre link mas tenta logar com email diferente**: server-side check em `consumeInvitationAction` — `email_mismatch`. UI mostra "este link é para `x@axon.com`, você está logado como `y@axon.com`. Faça logout antes de continuar."
- [ ] **Convidado não está em org `axon`**: durante `consumeInvitationAction`, garantir que profile criado/identificado tem `organization_id` da org interna. Se não, mover via service client (recomendação spec) ou rejeitar com `'profile_org_mismatch'` apontando para runbook seed_owner.
- [ ] **Owner tenta desativar a si mesmo (último owner)**: trigger Sprint 02 dispara `'last_owner_protected'`; UI mostra erro tipado.
- [ ] **Owner tenta downgrade do papel próprio (sendo último owner)**: mesma trigger.
- [ ] **2 owners clicam "desativar" no mesmo target em paralelo**: FOR UPDATE (ou optimistic via `updated_at`) — 1 vence, outra recebe erro de concorrência. Spec define mecanismo.
- [ ] **Owner solicita reset MFA do próprio**: CHECK na tabela rejeita; RPC traduz para `'self_request_forbidden'`. UI esconde botão para o próprio admin.
- [ ] **Owner A aprova reset que ele mesmo solicitou**: CHECK rejeita; UI esconde botão "aprovar" se `request.requested_by === currentUser.profileId`.
- [ ] **Target aprova reset do próprio**: CHECK rejeita; UI esconde botão "aprovar" se `request.target_profile_id === currentUser.profileId`.
- [ ] **Apenas 2 owners no sistema**: A solicita reset de B; quem aprova? Sistema fica em deadlock até um terceiro owner ser convidado, OU break-glass (Sprint 12). Sprint 11 documenta limitação no runbook + UI mostra alerta "atenção: você precisa de um terceiro owner para aprovação".
- [ ] **Pedido de reset MFA expira sem aprovação (> 24h)**: linha permanece com `expires_at < now()`; UI lista como "Expirado"; tentativa de aprovar falha com `'mfa_reset_request_expired'`.
- [ ] **Reset MFA aprovado mas target não completa re-enroll**: target permanece com `mfa_reset_required=true` indefinidamente; middleware redireciona em todo request. Sem auto-cleanup (admin precisa completar). Spec valida se há TTL para forçar revogação automática (recomendação: sim, 7 dias após aprovação sem consume → revoga automaticamente via job pg_cron — mas isso pode ir para Sprint 13 que já lida com pg_cron; aqui apenas documentar).
- [ ] **Admin completa password reset, mas é customer (não-admin)**: `mark_admin_password_reset` no-op silencioso; sem flag setada; sem audit `password_reset.complete_admin` (apenas customer-side audit, fora deste sprint).
- [ ] **Admin passou por password reset E está com `mfa_reset_required=true` por pedido aprovado**: cenário acumulado. Re-enroll único satisfaz ambos — `consume_admin_mfa_reset` (se há request) precede `complete_admin_mfa_reenroll`. Spec valida ordem.
- [ ] **Convidado consome invitation com sucesso mas falha ao enrollar MFA**: estado parcial — `platform_admins` linha existe, `auth.mfa_factors` vazio. Próximo login do convidado: `requireAdminSession` redireciona para `/admin/mfa-enroll?firstEnroll=true`. Aceitável (não é incidente — é o caminho feliz "completar enroll depois").
- [ ] **Tentativa de chamar `admin_consume_platform_admin_invitation` direto via JWT regular**: REVOKE FROM authenticated/anon impede. Teste documenta.
- [ ] **Tentativa de SELECT direto na tabela `platform_admin_invitations` por customer user**: RLS rejeita (policy SELECT exige `is_platform_admin`).
- [ ] **Mesmo browser logado como customer + admin** (caso T-15 simétrico): Sprint 04 isolation já cobre via subdomínio + cookie domain. Sprint 11 não introduz nova superfície.
- [ ] **Audit nunca contém senha plaintext**: nem `consumeInvitationAction` nem `completeAdminPasswordResetAction` logam `newPassword` em audit; payload de audit é `metadata = { kind, target_profile_id }`. Guardian valida via grep.
- [ ] **Email do convite formatado com payload XSS**: `inviterName` ou `role` injetadas no template HTML. Template usa escape literal (sem `dangerouslySetInnerHTML` — só interpolação de strings com escape default do framework de template). Spec confirma.

---

## 🚫 Fora de escopo

- **Reativar admin desativado** — não previsto no MVP. Re-convite é o caminho. Spec valida (alternativa: adicionar `admin_reactivate_platform_admin` análogo a `admin_suspend/reactivate_organization` do Sprint 05; recomendação: deixar fora — superfície de erro e regra de invariante extra).
- **Convidar admin sem MFA enroll obrigatório** — invariável. MFA é parte do fluxo de aceite, não opcional.
- **Reset de senha de admin sem MFA re-enroll** — invariável. Reset = invalidação do TOTP.
- **Step-up para outras ações sensíveis** (ex: revogar credencial de email, desativar org) — Sprint 11 entrega step-up apenas para reset MFA. Generalização para outras ações é fase 2.
- **Cleanup automático de convites expirados/consumidos** — não há job de purge. Tabelas crescem; volume esperado baixo (≤100 convites/ano).
- **Cleanup automático de pedidos de reset MFA expirados** — mesma decisão. Spec lista como follow-up para Sprint 13 (pg_cron) se virar problema.
- **UI de visualização do audit log** — Sprint 12 (audit UI + rate limit + break-glass).
- **Rate limit em login admin** — Sprint 12 (`login_attempts_admin` tabela).
- **Break-glass CLI** — Sprint 12.
- **Self-service de password reset para admin** com fluxo customizado — usa o fluxo padrão Supabase (`auth.resetPasswordForEmail`); este sprint apenas wrappa a página de redefinir-senha com `completeAdminPasswordResetAction` para acionar `mark_admin_password_reset`. UI de "esqueci minha senha" não é nova rota — é a `/admin/login` com link "Esqueci minha senha".
- **Notificação por email para o target quando reset MFA é solicitado/aprovado** — sender já existe (Sprint 10) mas ficou fora do escopo. Comunicação é out-of-band (Slack/voz). Spec valida se inclui agora ou difere.
- **Templates de email com branding completo (HTML rico)** — Sprint 11 entrega template básico (HTML simples com CTA button via tabela inline). Branding fica para fase 2 (componente de email design system).
- **Rotação automática de papéis/permissions** — sem rotina agendada. Mudanças são manuais via UI.
- **Migração das `invitations` (customer)** para usar `sendEmail` próprio — Sprint 10 fora-de-escopo já documentou. Continua usando `supabase.auth.admin.inviteUserByEmail`. Sprint 11 só consome o sender para `platform_admin_invitations`.
- **2FA via SMS/email** — apenas TOTP (Supabase Auth nativo). SMS/email backup é fase 2.
- **Recovery codes** — não há geração de códigos de backup. Perdeu TOTP? Pede reset. Recovery codes ficam para fase 2.

---

## ⚠️ Critérios de Aceite

- [ ] 2 tabelas novas (`platform_admin_invitations`, `platform_admin_mfa_reset_requests`) criadas com `FORCE RLS`. Validar:
  ```sql
  SELECT relname, relforcerowsecurity FROM pg_class
   WHERE relname IN ('platform_admin_invitations','platform_admin_mfa_reset_requests');
  -- esperado: ambas com t
  ```
- [ ] Coluna `profiles.mfa_reset_required boolean NOT NULL DEFAULT false` criada e default aplicado a linhas existentes (zero linhas com NULL).
- [ ] **G-15 (single-use)**: criar invitation → 2 chamadas concorrentes a `consumeInvitationAction` → exatamente 1 cria linha em `platform_admins`; outra recebe `'invitation_already_consumed'`.
- [ ] **G-22 (MFA re-enroll pós-reset)**: simular `completeAdminPasswordResetAction` → `profiles.mfa_reset_required=true`; chamar `requireAdminSession()` → retorna redirect `/admin/mfa-enroll?reenroll=true`; chamar `completeAdminMfaReenrollAction` → flag volta a `false` + factor antigo invalidado.
- [ ] **G-08 revalidado (last-owner)**: tentar desativar o último owner via `deactivatePlatformAdminAction` → `'last_owner_protected'`. Tentar downgrade do último owner via `changePlatformAdminRoleAction` → mesma trigger. Validado por teste integrado (sem precisar tocar no banco real — trigger é exercitado pelo mock do client).
- [ ] **Step-up duplo de reset MFA**:
  - Auto-solicitação rejeitada (`requested_by = target`) por CHECK + RPC.
  - Auto-aprovação rejeitada (`approved_by = requested_by`) por CHECK + RPC.
  - Target-aprovação rejeitada (`approved_by = target`) por CHECK + RPC.
  - Validado por SQL constraint check (forçar valor inválido via service_role direto e esperar erro de check_violation).
- [ ] RPCs criadas com privilégios corretos:
  ```sql
  -- Convite/CRUD: chamadas via service_role no Server Action; anon nunca.
  SELECT has_function_privilege('anon', 'public.admin_create_platform_admin_invitation(text,text)', 'execute');  -- false
  SELECT has_function_privilege('anon', 'public.admin_consume_platform_admin_invitation(uuid,uuid)', 'execute');  -- false
  SELECT has_function_privilege('service_role', 'public.admin_consume_platform_admin_invitation(uuid,uuid)', 'execute'); -- true
  SELECT has_function_privilege('anon', 'public.mark_admin_password_reset(uuid)', 'execute');                     -- false
  SELECT has_function_privilege('service_role', 'public.mark_admin_password_reset(uuid)', 'execute');             -- true
  SELECT has_function_privilege('anon', 'public.complete_admin_mfa_reenroll(uuid)', 'execute');                   -- false
  SELECT has_function_privilege('service_role', 'public.complete_admin_mfa_reenroll(uuid)', 'execute');           -- true
  ```
- [ ] Toda mutation grava em `audit_log` com action slug correto, `target_type` correto, `metadata` sem dados sensíveis (sem senhas, sem tokens — apenas `target_profile_id` / `email` / `role` / `reason`). Validar via SQL pós-teste:
  ```sql
  SELECT action, target_type FROM audit_log
   WHERE action LIKE 'platform_admin.%' OR action = 'password_reset.complete_admin'
   ORDER BY occurred_at DESC LIMIT 20;
  -- esperado: action slugs documentados no header
  ```
- [ ] UI `/admin/admins` renderiza nos 3 estados (lista vazia, com admins/convites/resets, com erro). Tabs trocam sem reload.
- [ ] UI `/admin/admins/invite` mostra `offlineLink` quando sender retorna `fallback_offline`; toast "convite enviado" quando `sent`.
- [ ] UI `/admin/accept-invite/[token]` rejeita corretamente os 4 estados (válido / expirado / consumido / revogado) e completa o fluxo válido em 3 passos (form → MFA → redirect).
- [ ] RBAC respeitada:
  - owner: cria/revoga convite, muda papel, desativa, solicita/aprova/revoga reset MFA.
  - support+billing: lê tudo; **sem botões de mutação visíveis** (escondidos via gate visual + RPC re-valida).
  - customer user: 403 ao acessar `/admin/admins/*`.
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] **GATE 4.5**: 3 arquivos de teste integrado (`admin-platform-admins.test.ts`, `admin-mfa-reset.test.ts`, `admin-auth-password-reset.test.ts`) passam com 0 falhas, 0 skips, ~40 testes total.
- [ ] **Guardian aprova o código** (GATE 4) — incluindo:
  1. Nenhum return de Server Action contém `password`/`token` em payload de audit ou response (grep guard).
  2. `<button>` inline para variantes existentes (`danger`, `secondary`) é proibido — usar `<Button variant>` (APRENDIZADOS 2026-04-21+2026-04-20).
  3. Página pública `/admin/accept-invite/[token]` não consome `requireAdminSession` (verificado por leitura — rota pública).
  4. Server Actions de auth admin (`completeAdminPasswordResetAction`, `completeAdminMfaReenrollAction`) têm `import 'server-only'`.
  5. Trigger Sprint 02 ainda ativo (não regrediu) — validado por SQL.
- [ ] **GATE 5 estático**: `node scripts/verify-design.mjs --changed` retorna 0 violações.
- [ ] `docs/conventions/audit.md` apêndou 9 ações novas (`platform_admin.invite_create`, `invite_consume`, `invite_revoke`, `role_change`, `deactivate`, `mfa_reset_request`, `mfa_reset_approve`, `mfa_reset_revoke`, `mfa_reset_consume`, `password_reset.complete_admin`, `password_reset.mfa_reenroll_complete`).
- [ ] `docs/conventions/standards.md` § "Exceções em `public.*`" e `docs/PROJECT_CONTEXT.md` §2 atualizados com as 2 tabelas novas.
- [ ] `docs/PROJECT_CONTEXT.md` §5 ganha bloco §5e documentando: 2 tabelas + coluna `profiles.mfa_reset_required` + 12 RPCs novas + decisão step-up duplo + integração com sender Sprint 10 (`email_delivery_log_id` em invitations).
- [ ] `docs/admin_area/rbac_matrix.md` atualizado para incluir as ações novas de Sprint 11 (CRUD admin + step-up MFA reset).
- [ ] `docs/admin_area/runbook_seed_owner.md` (Sprint 02) atualizado com nota: "após Sprint 11, primeiro owner adicional pode ser convidado via UI; runbook só se aplica a bootstrap inicial ou recovery via break-glass".

---

## 🤖 Recomendação de Execução

**Análise:**
- Nível: STANDARD
- Complexity Score: **24** (cap em 22 para árvore de decisão; ≥9 já força Opção 2)
  - DB: **+9** (2 novas tabelas — `platform_admin_invitations` +3 com UNIQUE parcial + 3 CHECK de coerência + FK lógica para `email_delivery_log`, `platform_admin_mfa_reset_requests` +3 com 5 CHECKs críticos contra bypass de service_role + UNIQUE parcial; 1 coluna nova em `profiles` +1; modificação de tabela existente +2)
  - API/Actions: **+10** (12 RPCs novas — 7 mutações admin + 3 service-role para flow de password/MFA + 2 reads; ~10 Server Actions novas em 2 arquivos; modificação de `requireAdminSession` Sprint 04 — alto risco de regressão na auth de toda área admin)
  - UI: **+3** (4 rotas novas + ~10 componentes novos + modificação de página `mfa-enroll` Sprint 04 + sidebar)
  - Lógica: **+5** (atomicidade single-use com semântica clara para os 4 estados de invitation, step-up duplo com 3 invariantes anti-bypass — anti-self-request, anti-self-approve, anti-target-approve, fluxo end-to-end de password reset → re-enroll obrigatório, fluxo de aceite em 3 passos com criação opcional de profile, ortogonalidade entre `mfa_reset_request` consumido E password reset não-acompanhado de step-up)
  - Dependências: **+5** (interna: Sprints 02/03/04/10 — risco médio de regressão em `requireAdminSession` Sprint 04 e em `sendEmail` Sprint 10; nodemailer Sprint 10 + `auth.mfa.*` API do Supabase já em uso desde Sprint 04)
  - **Total bruto: ~32** (cap em 22 — qualquer ≥9 já força Opção 2)
- Reference Module: **parcial** — Sprints 05/06/09/10 são gold standard para padrão de RPC + Server Action + UI list/form/dialog; Sprint 02 é referência exata para trigger last-owner; `invitations` customer é referência exata para single-use atômico; **sem reference module direto** para step-up duplo (primeiro do projeto), fluxo de aceite anônimo de 3 passos com criação de account, e hook de password reset que detecta platform admin.
- Integração com API externa: **sim** — Supabase Auth API (`auth.mfa.{enroll,verify,unenroll}`, `auth.admin.createUser`, `auth.updateUser`, `auth.resetPasswordForEmail`); `sendEmail` (Sprint 10) é interno mas com contrato discriminado já validado. Item 2 da árvore (Integração com API externa → Opção 2 forçada) também dispara.
- Lógica de negócio nova/ambígua: **sim, alta** — pontos críticos:
  - **(a) Atomicidade single-use:** UPDATE atômico vs FOR UPDATE — spec valida qual primitivo Postgres é suficiente para os 4 estados (válido/expirado/consumido/revogado).
  - **(b) Step-up duplo:** modelo de tabela vs modelo de fila vs modelo de estado em `platform_admins` — recomendação tabela dedicada `platform_admin_mfa_reset_requests`; spec valida.
  - **(c) Hook de password reset:** Server Action wrapper (`completeAdminPasswordResetAction`) vs Auth Hook em `auth.users` — recomendação Server Action; spec valida que `auth.updateUser` retorna feedback síncrono confiável.
  - **(d) Cardinalidade convite vs admin:** consume invitation cria a linha em `platform_admins` ou só "linka" um profile existente? spec valida — recomendação: se profile existe (já é membro de `axon`), apenas UPDATE; se não, criar `auth.user` + `profile` + `platform_admin` em transação.
  - **(e) Localização do MFA enroll após aceite:** invocar `MfaEnrollForm` dentro da página de aceite ou redirecionar para `/admin/mfa-enroll`? spec valida — UX melhor é fluxo único na própria página de aceite, mas spec confirma viabilidade técnica (Supabase `auth.mfa.enroll` requer sessão estabelecida).
  - **(f) Invalidação de TOTP antigo no re-enroll:** `auth.mfa.unenroll(oldFactor)` antes ou depois de `auth.mfa.enroll(newFactor)` verificado? spec valida ordem (recomendação: enroll new + verify → unenroll old, para evitar janela sem MFA).
  - **(g) Página de aceite anônima vs autenticada:** convidado pode chegar logado em outra conta admin/customer; spec define comportamento (forçar logout? exigir match de email?).
  - **(h) Concorrência de aprovação MFA reset:** 2 owners aprovam ao mesmo tempo — qual vence? FOR UPDATE no RPC deveria garantir 1; spec valida.
  - **(i) Visibilidade do botão "Solicitar reset MFA":** owner-only ou qualquer admin pode solicitar (esperando aprovação)? Plano diz step-up entre 2 owners — recomendação: solicitação só por owner; spec valida contra rbac_matrix.
  - **(j) Risk de inflar para Sprint 11b:** plano permite quebrar se step-up duplo crescer demais. Spec avalia ao final do Implementation Plan se vale ramificar — corte de complexidade se vai além de ~30% do escopo.
- Ambiguity Risk: **alto** — primeiro sprint do projeto com step-up duplo, primeiro com fluxo de aceite anônimo de account creation, primeiro com modificação não-trivial de `requireAdminSession` (Sprint 04 entregou isso e ele agora tem que ler nova coluna). Drift em qualquer um dos 10 pontos acima vira retrabalho ou — pior — janela de bypass de auth.

---

### Opção 1 — SIMPLES (sem PRD)
- **Fluxo:** Tech Lead → `@db-admin` → `@backend` → `@qa-integration` → `@frontend+` → `@guardian` → gates → commit
- **PRD:** pulado; sprint file é o contrato
- **Modelo sugerido:** N/A — score ≥9 + integração com API externa (Supabase Auth + sender Sprint 10) + lógica de negócio nova ambígua (10 pontos) + múltiplas tabelas novas (≥2) **forçam Opção 2** pela rubrica (4 caminhos independentes).
- **Quando faz sentido:** **não faz sentido aqui.** 2 tabelas novas + 1 coluna em tabela crítica (`profiles`) + 12 RPCs + modificação de middleware de auth (Sprint 04) + fluxo de aceite anônimo + step-up duplo. Risco G-22 (bypass de MFA re-enroll) é P0 de segurança. Risco G-08 revalidado (last-owner) é incidente de lockout. Executar em Sonnet sem cold review é loteria.

### Opção 2 — COMPLETA (com PRD)
- **Fluxo:** Tech Lead → `@spec-writer` (Implementation Plan) → `@sanity-checker` (loop ≤3×) → STOP & WAIT → `@db-admin` → `@backend` → `@qa-integration` → `@frontend+` → `@guardian` → gates → commit
- **PRD:** gerado em `prds/prd_admin_11_admins_invite_mfa_reset.md`
- **Modelo sugerido:** **Opus** — cold review do `@spec-writer` + sanity-checker pagam o custo; em Sonnet drifta com 2 tabelas + 12 RPCs + modificação de auth middleware + step-up duplo + 10 decisões de design + risco G-22.
- **Quando faz sentido:** **aqui.** A rubrica força Opção 2 por **quatro caminhos independentes**: (1) score ≥9 (item 1), (2) integração com API externa (item 2 — Supabase Auth API + sender Sprint 10), (3) lógica de negócio nova/ambígua em 10 pontos críticos (item 3), (4) múltiplas tabelas novas (item 4 — `platform_admin_invitations` + `platform_admin_mfa_reset_requests`). O `@spec-writer` precisa fixar antes do `@db-admin` começar:
  1. **Schema canônico** das 2 tabelas com CHECKs exatos, índices, UNIQUE parciais, FK lógica.
  2. **Privilege model exaustivo** das 12 RPCs (quem chama via service_role, quem chama via JWT auth+role, quem nunca chama).
  3. **Atomicidade do consume** — validar que `UPDATE ... WHERE consumed_at IS NULL` em transação default Postgres é suficiente para G-15 (sem precisar SERIALIZABLE explícito).
  4. **Modelo step-up duplo** — alternativas de tabela vs fila vs flag em `platform_admins`; recomendação tabela dedicada validada.
  5. **Hook de password reset** — Server Action wrapper validado contra Auth Hook (recomendação Server Action; spec valida com snippet canônico).
  6. **Fluxo de aceite em 3 passos** — comportamento exato para profile existente vs não-existente, match de email, MFA enroll dentro da própria página vs redirect.
  7. **Modificação mínima de `requireAdminSession`** — adicionar 1 query (mfa_reset_required); spec valida JOIN vs round-trip extra.
  8. **Reconciliação com `rbac_matrix.md`** — 9 ações novas categorizadas por papel. Spec atualiza matriz em PRD; `@backend` aplica as edits no doc real.
  9. **Decisão (j) sobre 11b** — spec avalia ao final se step-up duplo cabe sem inflar; se inflar > 30%, recomenda fragmentar. Recomendação atual: cabe — modelo é simples (1 tabela com CHECKs), 2 RPCs (request, approve), 1 RPC consume, 1 página UI extra, 1 dialog de aprovação.
  10. **Estratégia de mock** dos integration tests — como simular `auth.mfa.{enroll,verify,unenroll,challenge}` consistentemente entre os 3 arquivos de teste sem duplicação.

---

**Recomendação do @sprint-creator:** **Opção 2 — Opus** (forçada pela rubrica em 4 caminhos)

**Justificativa:**
Score ≥9 dispara item 1 da árvore. Integração com Supabase Auth API + sender Sprint 10 dispara item 2. Lógica de negócio nova/ambígua em 10 pontos dispara item 3. Múltiplas tabelas novas (≥2) dispara item 4. Esta é a primeira sprint do projeto com **step-up duplo**, **fluxo de aceite anônimo com criação de account**, e **modificação não-trivial do middleware de auth `requireAdminSession`** entregue no Sprint 04 — qualquer drift em (a) atomicidade do consume, (b) modelo step-up, (c) hook de password reset, ou (f) ordem de invalidação do TOTP antigo gera incidente de segurança classe G-22 (bypass de MFA re-enroll = elevação de privilégio com senha apenas). O `@spec-writer` precisa fixar privilege model das 12 RPCs, schema canônico das 2 tabelas com 8 CHECK constraints, e o snippet canônico de modificação de `requireAdminSession` antes do `@db-admin` mexer. Sprint 12 (audit UI + rate limit + break-glass) depende deste sprint estar 100% auditado para popular dados realísticos. O `@sanity-checker` valida contra RF-ADMIN-3, RF-ADMIN-4, RF-AUTH-7, INV-3, G-08, G-15, G-22, T-15 do PRD admin.

**Aguardando escolha do usuário:** responda ao Tech Lead com `"execute opção 2"` (recomendado) ou `"execute"` (aceita a recomendação). Opção 1 não é adequada aqui — a rubrica força Opção 2 por quatro caminhos independentes.

---

## 🔄 Execução

> Esta seção é preenchida durante a execução. Cada agente atualiza sua linha antes de reportar conclusão ao Tech Lead. O Tech Lead atualiza a linha do `@guardian` e a linha Git no encerramento.

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| PRD Técnico (Implementation Plan) | `@spec-writer` | ✅ Concluído | [`prds/prd_admin_11_admins_invite_mfa_reset.md`](../../prds/prd_admin_11_admins_invite_mfa_reset.md) |
| Sanity Check | `@sanity-checker` | ✅ Concluído | APROVADO no Binary Approval Script (S0–S6) após quick-fix em §6 (categoria 7 "Browser/ambiente") |
| Banco de dados | `@db-admin` | ✅ Concluído | [`supabase/migrations/20260428000000_admin_11_platform_admin_invitations_mfa_reset.sql`](../../supabase/migrations/20260428000000_admin_11_platform_admin_invitations_mfa_reset.sql) — 2 tabelas + 1 coluna + 15 RPCs; GATE 1 passou (9/9 validações); +standards.md exceções +PROJECT_CONTEXT.md §2/§5e |
| Server Actions + helpers admin auth | `@backend` | ✅ Concluído | [`src/lib/actions/admin/platform-admins.ts`](../../src/lib/actions/admin/platform-admins.ts) (11 actions) + [`admin-auth.ts`](../../src/lib/actions/admin/admin-auth.ts) (2 actions) + [`src/lib/email/templates/admin-invitation.ts`](../../src/lib/email/templates/admin-invitation.ts) + middleware patch + rbac_matrix/runbook updates; GATE 2 PASS (build + lint) |
| Integration tests | `@qa-integration` | ✅ Concluído | [`tests/integration/admin-platform-admins.test.ts`](../../tests/integration/admin-platform-admins.test.ts) (24) + [`admin-mfa-reset.test.ts`](../../tests/integration/admin-mfa-reset.test.ts) (14) + [`admin-auth-password-reset.test.ts`](../../tests/integration/admin-auth-password-reset.test.ts) (8) — 46/46 passam, 0 skips |
| Frontend | `@frontend+` | ✅ Concluído | 4 rotas: [`/admin/admins`](../../src/app/admin/admins/page.tsx), [`/admin/admins/invite`](../../src/app/admin/admins/invite/page.tsx), [`/admin/admins/[id]`](../../src/app/admin/admins/[id]/page.tsx), [`/admin/accept-invite/[token]`](../../src/app/admin/accept-invite/[token]/page.tsx) + 13 componentes em [`src/components/admin/admins/`](../../src/components/admin/admins/) + modificação [`AdminMfaEnrollForm`](../../src/components/admin/AdminMfaEnrollForm.tsx) (mode `first`/`reenroll`/`standard`) + [`mfa-enroll/page.tsx`](../../src/app/admin/(auth)/mfa-enroll/page.tsx) com banners condicionais + [`AdminSidebar`](../../src/components/admin/AdminSidebar.tsx) item Administradores + [`middleware.ts`](../../src/middleware.ts) libera `/admin/accept-invite`; GATE 2 PASS (build + lint, zero novos warnings) |
| Guardian | `@guardian` | ✅ Concluído | GATE 4 APROVADO em agent mode (SDK). Result: [`sprints/handoffs/sprint_admin_11_admins_invite_mfa_reset/guardian_result.md`](../handoffs/sprint_admin_11_admins_invite_mfa_reset/guardian_result.md). Zero violações; 4 advisories não bloqueantes (hex literais em template de email — constraint HTML email; `<select>` nativo — convenção pré-existente; itens pré-existentes do Sprint 04 fora de escopo). |
| Git | Tech Lead | ⬜ Pendente | — |

**Legenda:** ⬜ Pendente · ▶️ Em andamento · ✅ Concluído · ⏸️ Aguarda review · n/a — não aplicável
