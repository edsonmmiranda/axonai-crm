# Sprint admin_10: Credenciais cifradas + bootstrap email com fallback

> **Nível:** STANDARD
> **Ciclo:** Admin Area · Sprint 10 de 13
> **Plano fonte:** [`docs/admin_area/sprint_plan.md`](../../docs/admin_area/sprint_plan.md) § Sprint 10
> **PRD fonte:** [`docs/admin_area/admin_area_prd.md`](../../docs/admin_area/admin_area_prd.md) § RF-SET-4, RF-SET-7, G-14, INV-6
> **Dependências satisfeitas:** sprint_admin_02 ✅ (`requirePlatformAdmin`/`requirePlatformAdminRole`, `is_platform_admin`) · sprint_admin_03 ✅ (`audit_write` + `writeAudit` helper) · sprint_admin_04 ✅ (shell `/admin/*` + `AdminShell`/`AdminSidebar`) · sprint_admin_09 ✅ (`platform_settings`, `feature_flags`, padrão de RPC admin com audit transacional, **seed `signup_link_offline_fallback_enabled=true` já persistido**)
> **Dependências NÃO satisfeitas (intencional):** sprint_admin_11 (CRUD platform admins + convite single-use) — **vai consumir** `src/lib/email/sender.ts` desta sprint para enviar tokens de convite. Sprint 10 entrega o sender pronto; Sprint 11 migra `invitations.ts` (que hoje usa Supabase Auth built-in) para o sender próprio.
> **Estado do banco consultado direto via MCP** — não usar `docs/schema_snapshot.json`.

---

## 🎯 Objetivo de Negócio

Resolver dois problemas que travam a operação da área admin antes do Sprint 11:

1. **Credenciais de integrações externas em claro no banco** (RF-SET-4) — qualquer credencial sensível (SMTP, futuras SMS/webhook keys) precisa ficar **cifrada em repouso**, com plaintext acessível apenas via decifragem server-side autorizada e nunca exposto em response da área admin (G-14).
2. **Bootstrap do email sem credencial configurada** (RF-SET-7) — admin chega na área administrativa pela primeira vez, ainda não cadastrou SMTP, mas **precisa convidar o segundo platform admin** (Sprint 11). Sem chicken-and-egg: o sistema cai numa **fallback chain** com 3 níveis (credencial cifrada no banco → env vars `BOOTSTRAP_EMAIL_*` → link copiável offline) e registra cada envio em `email_delivery_log` com auditoria de qual fonte foi usada.

Esta sprint **não** envia emails reais para customer users — só entrega a infra que outros sprints (11 convite admin, fase 2 emails transacionais customer) consomem. O escopo de email aqui é **transacional admin** (convites + reset).

**Métrica de sucesso:**
- `value_encrypted` plaintext **nunca** aparece em resposta JSON da área admin — validado por teste de regressão (G-14).
- Com `platform_integration_credentials` vazio E env vars `BOOTSTRAP_EMAIL_*` ausentes E `signup_link_offline_fallback_enabled=true`, chamar `sendEmail({ kind: 'invitation', ... })` retorna `{ status: 'fallback_offline', offlineLink: '...' }` e grava `email_delivery_log` com `source='offline_fallback'` — UI mostra link copiável ao admin.
- Com credencial SMTP cadastrada via UI, próxima chamada a `sendEmail` lê via Vault, envia via SMTP, grava `email_delivery_log` com `source='platform_setting'` e `status='sent'`.
- Banner global no shell admin "Email não configurado" desaparece quando ao menos uma fonte está disponível.
- Audit log registra **rotação** e **revogação** de credenciais com `before/after` mascarado (nunca o plaintext, nunca o secret_id do Vault).

---

## 👤 User Stories

- Como **platform admin owner**, quero cadastrar a credencial SMTP do nosso provider transacional uma única vez via UI, para que convites e emails admin saiam pelo nosso domínio sem vazar segredo no banco em claro.
- Como **platform admin owner**, quero rotacionar a credencial SMTP (mudei de provider, ou suspeito de comprometimento) sem gap de envio — a credencial nova entra em uso na próxima chamada e a anterior é revogada na mesma transação.
- Como **platform admin owner em primeiro acesso**, ainda não configurei nada — quero conseguir convidar o segundo owner via link copiável que recebo na própria UI, sem depender de email funcionando, para sair do chicken-and-egg.
- Como **platform admin owner**, ao acessar a área admin com email não configurado em nenhuma fonte, quero ver um banner persistente "Email não configurado — convites e resets vão gerar link copiável" para não confundir comportamento de fallback com bug.
- Como **DevOps/oncall**, em caso de incidente onde o banco perdeu acesso ao Vault, quero que o sender caia para `BOOTSTRAP_EMAIL_*` em env vars sem intervenção, para não bloquear convites críticos.
- Como **platform admin support**, quero **ler** (mas não alterar) a lista de credenciais cadastradas (kind, label, last_used_at, rotated_at) para diagnóstico — sem nunca ter acesso ao plaintext nem à UI de mutação.
- Como **auditor de segurança**, quero ver no `audit_log` toda criação/rotação/revogação de credencial com diff mascarado (`{kind, label, hint: '****abc'}`) e timestamp, para responder a pergunta "quem trocou a credencial X em Y" sem nunca ler plaintext.
- Como **customer user**, ainda não recebo nada deste sprint — só a infra fica disponível para sprints seguintes consumirem.

---

## 🎨 Referências Visuais

- **Layout admin:** já existe — `src/app/admin/layout.tsx` + `src/components/admin/AdminShell.tsx`. Esta sprint adiciona uma rota nova sob `/admin/settings/integrations/email` e um **banner global** dentro do shell quando a fonte de email está ausente.
- **Página de configuração SMTP:** layout em formulário simples (1 coluna) com seções:
  - **Status atual** (card com badges: "Configurado" / "Usando env vars" / "Não configurado") + linha "última utilização: há Xmin" / "rotacionada há X dias" / "nunca usada".
  - **Configurar/Rotacionar** (form com host, port, user, password — password sempre `<input type="password">`, mostra `••••` quando há credencial existente, NUNCA o valor real).
  - **Revogar** (botão destrutivo com confirmação digitada do `kind` — RNF-UX-2).
- **Banner global "Email não configurado":** linha persistente no topo do shell admin (acima do header), `bg-feedback-warning-subtle text-feedback-warning-strong`, com texto "Email não configurado — convites e resets gerarão link copiável" + link "Configurar agora" para `/admin/settings/integrations/email`. Renderizado via Server Component que consulta `getEmailSourceStatus()` no layout.
- **Componentes do design system a reutilizar:** `Button`, `Input`, `Label`, `Dialog`, `Card`, `Badge`, `Alert`/banner. Reutilizar padrão `<Button variant="danger">` e `<Button variant="secondary">` do Sprint 09 — APRENDIZADOS 2026-04-21 alerta sobre repetir botão inline.

---

## 🧬 Reference Module Compliance

**Parcialmente aplicável.**

1. **Padrão de RPC com audit transacional + Server Action wrapper admin:** Sprints 05/06/07/09 são gold standard — copiar literalmente:
   - Header de RPC com `SECURITY DEFINER`, `REVOKE EXECUTE FROM anon` (APRENDIZADOS 2026-04-24 — `REVOKE FROM public` não cobre `anon`).
   - Validação `requirePlatformAdminRole(['owner'])` em mutations; `requirePlatformAdmin()` em reads.
   - `audit_write(...)` na mesma transação do mutation.
   - Mapeamento de erro tipado em `actions/*.schemas.ts` → `actions/*.ts` usando o helper de narrowing tipado de `PostgrestError` (APRENDIZADOS 2026-04-26 — `error instanceof Error` é falso para `PostgrestError`).

2. **Padrão de UI admin (settings page):** Sprint 09 — `src/app/admin/settings/{feature-flags,trial,legal}/page.tsx` é a referência direta. Mesma estrutura: Server Component carrega estado, Client Component renderiza form/dialog, toast para feedback, RBAC gate visual (botões mutation ocultos para non-owner).

3. **Sem reference module direto** para:
   - **Integração com Supabase Vault** (`vault.create_secret`, `vault.decrypted_secrets`) — primeiro uso no projeto. O `@spec-writer` (Opção 2) define o snippet canônico que pode ser reutilizado em fase 2 quando entrarem outras integrações cifradas (SMS, webhook keys).
   - **Fallback chain de credenciais** (DB → env → offline) — primeiro caso. Spec define a ordem exata, o ponto de leitura (server-only, nunca em Server Component que renderiza ao customer), e a forma do retorno (`{ source, transport, ... }` ou `{ source: 'offline_fallback', offlineLink }`).
   - **Envio SMTP via nodemailer** — não há código de email transacional próprio hoje (convites usam `supabase.auth.admin.inviteUserByEmail` que delega ao SMTP do dashboard Supabase). Spec decide o transporte: **recomendação preliminar = nodemailer com SMTP genérico** (portável, qualquer provider funciona via env vars). Spec valida.

**O que copiar:** estrutura de RPC com audit (Sprint 09), formato de `ActionResponse` mapeando erros tipados, padrão de UI settings page com Server Component + Client Component (Sprint 09).
**O que trocar:** tabelas alvo (`platform_integration_credentials`, `email_delivery_log`), schemas Zod específicos de credencial, payloads de audit (action slugs `integration_credential.create` / `integration_credential.rotate` / `integration_credential.revoke` / `email.delivery_logged`).
**O que NÃO copiar:** lógica de feature flag registry (Sprint 09 é catálogo público; aqui é segredo cifrado — direção oposta de exposição) nem lógica de versionamento append-only (`legal_policies` Sprint 09 vs aqui credenciais são mutáveis com histórico via audit, não via tabela).

---

## 📋 Funcionalidades (Escopo)

### Backend

#### Banco de dados (autor: `@db-admin`)

> **Decisão de cifragem (pré-fixada — spec valida):** usar **Supabase Vault** (`extensions.vault`, schema `vault`) — **já instalado** (v0.3.1) neste projeto. `pgsodium` está disponível no catálogo mas **não habilitado**, e exigiria setup de master key + privilégios extras. Vault armazena secrets em `vault.secrets` cifrados com chave gerenciada pelo Supabase, e expõe a view `vault.decrypted_secrets` (apenas para roles autorizadas) para decifragem on-demand. RPC server-side fica como única ponte autorizada ao plaintext.

- [ ] **Tabela `platform_integration_credentials`** (metadata da credencial; secret real vive no Vault):
  - Colunas:
    - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
    - `kind text NOT NULL CHECK (kind IN ('email_smtp'))` — enum aberto para fase 2 (`email_provider_resend`, `sms_twilio`, etc.); novos valores via migration explícita.
    - `label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80)` — humano-legível (ex: "Production SMTP — Brevo").
    - `vault_secret_id uuid NOT NULL` — FK lógica para `vault.secrets.id`. NÃO declarada como FK física (Vault é cross-schema; preserva idempotência da migration). Constraint UNIQUE + check no mutation RPC garante consistência.
    - `metadata_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb` — config não-secreta (ex: para SMTP: `{ host, port, user, from_email, secure }`. Senha vai cifrada para o Vault separadamente).
    - `hint text NULL CHECK (hint IS NULL OR length(hint) BETWEEN 4 AND 8)` — últimos N chars da credencial para a UI exibir "••••abc" (NUNCA permite reconstrução; spec define tamanho exato — recomendação: últimos 4 chars com prefixo `****`).
    - `created_at timestamptz NOT NULL DEFAULT now()`
    - `created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT`
    - `last_used_at timestamptz NULL` — atualizado via RPC `mark_credential_used` chamada pelo sender após envio bem-sucedido.
    - `rotated_at timestamptz NULL` — preenchido na rotação (substitui o secret no Vault e cria nova linha; a anterior é revogada na mesma transação).
    - `revoked_at timestamptz NULL` — soft-revoke; query de "credencial ativa" filtra `WHERE revoked_at IS NULL`.
  - **UNIQUE parcial** `(kind) WHERE revoked_at IS NULL` — garante **uma credencial ativa por kind** (mesma família que INV-1 do Sprint 01 com subscriptions).
  - **FORCE RLS.** Policies:
    - SELECT: platform admins ativos (`is_platform_admin(auth.uid())`) — retorna **apenas metadata** (sem `vault_secret_id` em uma view pública? **Não** — `vault_secret_id` é UUID opaco; sozinho não permite decifrar. A defesa real é o REVOKE de `vault.decrypted_secrets` para `authenticated`/`anon`, garantido pelo Supabase. Spec confirma).
    - **Sem policies de mutação** — writes via RPCs `SECURITY DEFINER`.

- [ ] **Tabela `email_delivery_log`** (rastreio de envios + fallback offline):
  - Colunas:
    - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
    - `recipient text NOT NULL CHECK (length(recipient) BETWEEN 3 AND 320)` — email destinatário; NÃO mascarado (admin precisa diagnosticar).
    - `subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200)`
    - `kind text NOT NULL CHECK (kind IN ('invitation','password_reset','admin_notification'))` — enum aberto para fase 2.
    - `source text NOT NULL CHECK (source IN ('platform_setting','env_var','offline_fallback'))` — qual nível da fallback chain entregou.
    - `status text NOT NULL CHECK (status IN ('sent','fallback_offline','error'))` — `sent` = transport entregou OK; `fallback_offline` = link gerado, sem transport real; `error` = transport falhou (caller decide se faz retry ou fallback para o próximo nível da chain).
    - `offline_link text NULL` — preenchido apenas quando `source='offline_fallback'`. Link **completo, signed**, copiado pelo admin manualmente.
    - `error_message text NULL` — truncado a 1000 chars; preenchido quando `status='error'`.
    - `related_entity_type text NULL CHECK (related_entity_type IS NULL OR related_entity_type IN ('invitation','platform_admin_invitation','password_reset'))` — FK lógica para o objeto que disparou o envio.
    - `related_entity_id uuid NULL` — id do objeto.
    - `sent_at timestamptz NOT NULL DEFAULT now()`
    - `sent_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL` — admin que originou; null em jobs futuros.
  - Índices: `(sent_at DESC)`, `(recipient, sent_at DESC)`, `(related_entity_type, related_entity_id)`.
  - **FORCE RLS.** Policy SELECT: platform admins ativos. Sem policies de mutação — writes via RPC `log_email_delivery` (o sender escreve via service_role + RPC SECURITY DEFINER).
  - **Sem trigger de deny** UPDATE/DELETE — diferente de `audit_log`. Justificativa: log de email é operacional (retenção curta), não evidência forense imutável; admin pode querer purgar logs antigos. Spec valida.
  - **Sem seed** — populado em uso.

- [ ] **RPCs (todas `SECURITY DEFINER`, audit dentro da mesma transação quando aplicável):**

  - `admin_create_integration_credential(p_kind text, p_label text, p_metadata jsonb, p_secret_plaintext text)` — owner-only.
    - Valida que **não existe** credencial ativa para `p_kind` (UNIQUE parcial enforça, mas RPC traduz para erro tipado `'credential_kind_already_active'`).
    - Chama `vault.create_secret(p_secret_plaintext, p_kind || ':' || p_label, NULL)` — retorna `vault_secret_id`.
    - INSERT em `platform_integration_credentials` com o `vault_secret_id`, `hint = '****' || right(p_secret_plaintext, 4)`.
    - `audit_write('integration_credential.create', 'platform_integration_credential', new.id::text, NULL, NULL, jsonb_build_object('kind', kind, 'label', label, 'hint', hint), metadata)` — **NUNCA inclui plaintext nem `vault_secret_id`** no audit.
    - Retorna a row metadata (sem plaintext).
    - REVOKE EXECUTE FROM anon, authenticated, service_role (chamado via RLS-bypass apenas pelo service client em Server Action validada).

  - `admin_rotate_integration_credential(p_id uuid, p_new_secret_plaintext text, p_new_metadata jsonb)` — owner-only.
    - Lê linha existente (FOR UPDATE para isolar concorrência).
    - Cria novo secret no Vault.
    - **Atomicidade:** UPDATE do `vault_secret_id` para o novo, set `rotated_at=now()`, atualiza `hint` e `metadata_jsonb`. Se sucesso, drop do secret antigo via `vault.delete_secret(old_id)`.
    - `audit_write('integration_credential.rotate', 'platform_integration_credential', p_id::text, NULL, jsonb_build_object('hint_before', old_hint), jsonb_build_object('hint_after', new_hint), metadata)`.
    - Retorna row metadata.

  - `admin_revoke_integration_credential(p_id uuid)` — owner-only.
    - UPDATE set `revoked_at=now()`. Drop do secret no Vault (`vault.delete_secret`).
    - `audit_write('integration_credential.revoke', 'platform_integration_credential', p_id::text, jsonb_build_object('was_active', true), jsonb_build_object('revoked_at', now()), metadata)`.

  - `get_integration_credential_plaintext(p_kind text)` — `SECURITY DEFINER`, **REVOKE FROM authenticated/anon/public**, GRANT EXECUTE apenas para `service_role`. Justificativa: chamada apenas pelo `src/lib/email/getCredential.ts` server-only que usa o service client; nunca por código que recebe input do customer.
    - Lê linha ativa para `p_kind` (`WHERE revoked_at IS NULL`); se não há, raise `credential_not_found` (P0001).
    - Lê plaintext via `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = vault_secret_id`.
    - Retorna `(plaintext text, metadata jsonb, credential_id uuid)`.
    - **NÃO grava audit** — leitura legítima pelo sender é evento de alta frequência; em vez disso, chama `mark_credential_used` que atualiza `last_used_at` (rastro suficiente).
    - **⛔ Crítico:** esta RPC é o **único caminho** de plaintext fora do Vault. Qualquer outro caller que tente decifrar é violação de segurança — Guardian valida via grep.

  - `mark_credential_used(p_credential_id uuid)` — `SECURITY DEFINER`, REVOKE FROM anon/authenticated, GRANT EXECUTE para `service_role`. UPDATE `last_used_at = now()`. Sem audit.

  - `log_email_delivery(p_recipient text, p_subject text, p_kind text, p_source text, p_status text, p_offline_link text, p_error_message text, p_related_entity_type text, p_related_entity_id uuid, p_sent_by uuid)` — `SECURITY DEFINER`, REVOKE FROM anon/authenticated, GRANT EXECUTE para `service_role`. INSERT em `email_delivery_log`. Audit somente quando `source='offline_fallback'` (evento de baixa frequência, vale rastrear): `audit_write('email.delivery_offline_fallback', 'email_delivery', new.id::text, ...)`. Para `sent`/`error`, fica só na própria tabela `email_delivery_log` (alta frequência — não inflar audit).

  - `admin_list_integration_credentials()` — owner+support+billing read. Retorna `(id, kind, label, metadata_jsonb, hint, created_at, created_by, last_used_at, rotated_at, revoked_at)` — **sem `vault_secret_id`** na projeção (defesa em profundidade contra leak de UUID em response, mesmo que UUID isolado seja inerte sem privilégio de leitura no Vault).

  - `get_email_source_status() returns table(source text, configured bool)` — platform admin read. Retorna 3 linhas:
    - `('platform_setting', exists(SELECT 1 FROM platform_integration_credentials WHERE kind='email_smtp' AND revoked_at IS NULL))`
    - `('env_var', current_setting('app.bootstrap_email_configured', true) = 'true')` — **NB:** server-side helper TS calcula esse valor no boot e seta via session GUC; spec valida abordagem alternativa (RPC retorna apenas DB, helper TS combina com env vars).
    - `('offline_fallback', (SELECT value_bool FROM platform_settings WHERE key='signup_link_offline_fallback_enabled'))`
    - **Recomendação preliminar:** **mover toda a lógica de decisão para o helper TS** (`src/lib/email/getEmailSourceStatus.ts`) e remover esta RPC. RPC só faz sentido se quisermos consultar do banco; aqui o estado é majoritariamente em código/env. Spec decide.

- [ ] **Migration idempotente** com `IF NOT EXISTS` em todas as tabelas/policies; `CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault` (no-op se já instalado, como é o caso). Header da migration documenta as 2 novas tabelas, 7 RPCs, decisão Vault vs pgsodium, e ponto crítico de privilégios (`get_integration_credential_plaintext` é service-role-only).

#### Server Actions e helpers (autor: `@backend`)

- [ ] **`src/lib/email/getCredential.ts`** (server-only):
  - `getEmailCredential(): Promise<{ source, transport, ... } | null>` — implementa a fallback chain:
    1. Tenta `supabaseService.rpc('get_integration_credential_plaintext', { p_kind: 'email_smtp' })`. Se OK → retorna `{ source: 'platform_setting', transport: 'smtp', host, port, user, password: plaintext, from }` montando a partir de `metadata` + plaintext. Chama `mark_credential_used(credentialId)` em fire-and-forget (sem await crítico).
    2. Se RPC retornar `credential_not_found` ou Vault falhar: lê `process.env.BOOTSTRAP_EMAIL_HOST/PORT/USER/PASSWORD/FROM`. Se todas presentes → retorna `{ source: 'env_var', transport: 'smtp', ... }`.
    3. Se env vars ausentes: lê `signup_link_offline_fallback_enabled` de `platform_settings`. Se `true` → retorna `null` (caller dispara fallback offline). Se `false` → throw `EmailNotConfiguredError`.
  - **Cacheado por request** via `cache()` do React (mesmo padrão de `getPublicFlags` Sprint 09). Inválido entre requests para refletir mudança via UI.
  - **⛔ Helper é server-only** (`'use server'` ou import-restrictivo via `import 'server-only'`). Qualquer Client Component que importar este helper quebra build.

- [ ] **`src/lib/email/sender.ts`** (server-only):
  - `sendEmail(payload: { kind, to, subject, html, text?, related?: { type, id } }): Promise<EmailDeliveryResult>` — interface única para callers (Sprint 11 invitations vai consumir).
  - Lógica:
    1. Chama `getEmailCredential()`.
    2. Se retornou credencial (`source ∈ {'platform_setting','env_var'}`): usa `nodemailer` para enviar via SMTP. Em caso de sucesso, chama `log_email_delivery(... source, 'sent', ...)`. Em caso de erro do transport, **não** faz retry automático — chama `log_email_delivery(... source, 'error', error_message)` e retorna `{ status: 'error', deliveryLogId }`. Caller decide se tenta de novo.
    3. Se retornou `null` (offline fallback ativo): gera `offlineLink` (assinado via `crypto.randomBytes` + persistido em tabela auxiliar do caller — para invitations seria o token UUID já existente do `platform_admin_invitations` Sprint 11; aqui o sender recebe `offlineLink` **pré-construído pelo caller** ou gera signed URL genérica. **Spec decide** quem é responsável pelo link: caller passa, ou sender gera). Chama `log_email_delivery(... 'offline_fallback', 'fallback_offline', offlineLink, ...)`. Retorna `{ status: 'fallback_offline', offlineLink, deliveryLogId }`.
  - **Tipo de retorno discriminado:** `type EmailDeliveryResult = { status: 'sent', deliveryLogId } | { status: 'fallback_offline', offlineLink, deliveryLogId } | { status: 'error', deliveryLogId, errorMessage }`. Caller exaustivo via `switch (result.status)`.
  - **Dependência nova:** `nodemailer` (`npm install nodemailer @types/nodemailer`). Spec valida alternativas (Resend SDK puro, AWS SES SDK) — recomendação SMTP nodemailer pela portabilidade.

- [ ] **`src/lib/email/getEmailSourceStatus.ts`** (server-only):
  - `getEmailSourceStatus(): Promise<{ platformSetting: boolean, envVar: boolean, offlineFallback: boolean }>` — usado pelo banner global do shell.
  - Lê DB (1 query: `SELECT 1 FROM platform_integration_credentials WHERE kind='email_smtp' AND revoked_at IS NULL LIMIT 1`).
  - Lê env vars `BOOTSTRAP_EMAIL_HOST` (presença mínima — outros podem estar vazios mas a sprint considera "configurado" se HOST está setado; spec define).
  - Lê `signup_link_offline_fallback_enabled` de `platform_settings` (RPC `get_platform_setting` ou query direta — Sprint 09 não criou helper genérico; spec define se cria agora ou consome direto).

- [ ] **`src/lib/actions/admin/integration-credentials.ts`** + `.schemas.ts`:
  - `listIntegrationCredentialsAction()` — owner+support+billing read. Retorna lista de metadados (sem plaintext) via `admin_list_integration_credentials` RPC.
  - `createIntegrationCredentialAction({ kind, label, metadata, secretPlaintext })` — owner-only. Zod valida `kind` enum, `label` 1-80 chars, `metadata` shape conforme `kind` (para `email_smtp`: `{ host: string, port: number, user: string, secure: bool, fromEmail: string }`), `secretPlaintext` 1-500 chars não-vazio. Chama `admin_create_integration_credential` RPC.
  - `rotateIntegrationCredentialAction({ id, newSecretPlaintext, newMetadata })` — owner-only.
  - `revokeIntegrationCredentialAction({ id })` — owner-only. Confirmação extra via parâmetro `confirmKind: string` que precisa bater com `kind` da credencial alvo (server-side check) — RNF-UX-2.
  - **⛔ Crítico:** essas Server Actions **nunca retornam `secretPlaintext` nem `vaultSecretId`** no `ActionResponse`. Schema Zod do response **omite** explicitamente esses campos — Guardian valida via grep no `.schemas.ts`.

#### Integration tests (autor: `@qa-integration`)

- [ ] **`tests/integration/admin-integration-credentials.test.ts`** (mín. 12 testes):
  - `createIntegrationCredentialAction`:
    - happy owner: cria credencial, retorna metadata sem plaintext, audit gravado com `hint='****abc'` (sem plaintext).
    - RBAC: support e billing falham com `'forbidden'`.
    - Zod fail: `secretPlaintext` vazio, `metadata` sem `host`, `kind` fora do enum.
    - **G-14 explícito:** assert que response JSON **não contém** as substrings `secretPlaintext` nem o valor real do plaintext nem o `vault_secret_id`.
    - Duplicate active: criar 2× sem revogar a primeira → segunda falha com `'credential_kind_already_active'`.
  - `rotateIntegrationCredentialAction`:
    - happy: cria → rotaciona → assert `rotated_at` populado, `hint` mudou, audit com diff `{hint_before, hint_after}`.
    - RBAC: non-owner falha.
    - Concurrency: 2 rotações concorrentes — uma vence, outra recebe erro tipado (FOR UPDATE garante).
  - `revokeIntegrationCredentialAction`:
    - happy: cria → revoga → `revoked_at` populado, próxima query "ativa" retorna empty.
    - Confirm mismatch: `confirmKind` diferente do real → falha com `'confirm_kind_mismatch'`.

- [ ] **`tests/integration/email-sender.test.ts`** (mín. 10 testes — mock SMTP transport via nodemailer test transport):
  - `sendEmail` com credencial DB:
    - happy: cria credencial → chama sendEmail → assert `source='platform_setting'`, `status='sent'`, `email_delivery_log` row criada, `last_used_at` da credencial atualizado.
    - SMTP transport falha: nodemailer mockado para rejeitar → `status='error'`, `error_message` truncado a 1000 chars no log.
  - `sendEmail` com env vars apenas:
    - DB sem credencial + env vars completas → `source='env_var'`, `status='sent'`.
    - Env vars parciais (HOST sem PASSWORD) → cai para próximo nível (offline ou erro conforme setting).
  - `sendEmail` com offline fallback:
    - DB vazio + env vars vazias + `signup_link_offline_fallback_enabled=true` + caller passa `offlineLink` → `source='offline_fallback'`, `status='fallback_offline'`, log com link salvo, audit row criada.
    - DB vazio + env vars vazias + `signup_link_offline_fallback_enabled=false` → throw `EmailNotConfiguredError`.
  - **G-14 explícito:** mockar `nodemailer.createTransport` e assert que o `auth.pass` passado é o plaintext correto, mas o **return** do `sendEmail` não contém o plaintext em nenhum lugar.
  - `getEmailCredential()` cache: 2 chamadas dentro do mesmo request → 1 RPC.

- [ ] **`tests/integration/email-source-status.test.ts`** (mín. 6 testes):
  - DB credencial ativa → `{ platformSetting: true, envVar: false, offlineFallback: true }` (assumindo env não setado no test).
  - DB credencial revogada → `platformSetting: false`.
  - Env var HOST setada → `envVar: true`.
  - Setting `signup_link_offline_fallback_enabled=false` → `offlineFallback: false`.

- [ ] Mock central via `tests/setup.ts` `__mockSupabase` — sem hits reais ao banco. Sem `it.skip`.
- [ ] Mock de `nodemailer.createTransport` via Vitest `vi.mock('nodemailer')` — não enviar emails reais.
- [ ] Mock de `vault.create_secret` / `vault.decrypted_secrets` via Supabase RPC mock — retornar UUID previsível e plaintext determinístico.

### Frontend (autor: `@frontend+`)

- [ ] **Rota nova:** `src/app/admin/settings/integrations/email/page.tsx`
  - Server Component: chama `listIntegrationCredentialsAction()` filtrado por `kind='email_smtp'` + `getEmailSourceStatus()`.
  - Renderiza:
    - **Card "Status"** (estado atual): badge da fonte ativa + linha "última utilização: há Xmin" / "rotacionada há X dias" / "nunca usada" / "não configurado".
    - **Form "Configurar SMTP"** (Client Component `IntegrationCredentialForm`): campos `label`, `host`, `port`, `user`, `secure` (switch), `fromEmail`, `password`. Botão muda label entre "Configurar" (sem credencial) e "Rotacionar" (com credencial existente). Password input sempre `<input type="password">` com placeholder `••••` quando há credencial; valor real do password **nunca** é fetched para a UI (server **não retorna** plaintext, então o componente literalmente não tem acesso).
    - **Botão "Revogar"** (renderizado só se há credencial ativa): abre Dialog que exige digitar `email_smtp` para confirmar (RNF-UX-2). Owner-only — escondido para support/billing.
  - Loading skeleton, error state.
  - Acessibilidade: label associado a cada input, `aria-invalid` em erro de validação.

- [ ] **Componentes em `src/components/admin/settings/integrations/`:**
  - `IntegrationCredentialStatusCard.tsx` — Server Component. Consome lista + status.
  - `IntegrationCredentialForm.tsx` — Client Component com `react-hook-form` + `zodResolver`. Submit chama `createIntegrationCredentialAction` (sem credencial existente) ou `rotateIntegrationCredentialAction` (com). Toast.
  - `RevokeCredentialDialog.tsx` — Client Component. Confirma digitando `email_smtp`.

- [ ] **Banner global no shell:** `src/components/admin/EmailSourceBanner.tsx`
  - Server Component renderizado dentro de `AdminShell` (acima do header).
  - Lê `getEmailSourceStatus()`. Se `!platformSetting && !envVar`:
    - Se `offlineFallback=true`: banner amarelo "Email não configurado — convites e resets gerarão link copiável. [Configurar agora]" (não-bloqueante).
    - Se `offlineFallback=false`: banner vermelho "Email não configurado e fallback offline desativado — convites e resets vão falhar. [Configurar agora]" (não-bloqueante mas crítico).
  - Se ao menos uma fonte está ativa: não renderiza nada.
  - **Atenção:** `getEmailSourceStatus()` é chamada por request — se virar gargalo, cachear via React `cache()`. Spec valida.

- [ ] **Update do `AdminSidebar.tsx`** (Sprint 04, Sprint 09 já modificou):
  - Dentro do grupo "Configurações" existente (Sprint 09), adicionar subitem "Integrações" com sub-rota "Email" → `/admin/settings/integrations/email`. Estrutura preferida: nested item ou novo grupo "Integrações" no nível raiz. Spec decide.
  - Visibilidade: support+billing vê em modo read-only; owner vê + mutaciona.

- [ ] **Acessibilidade:** form com `aria-required` em campos obrigatórios. Banner com `role="alert"` (warning) ou `role="status"` conforme severidade. Dialog de revogar com foco trap (já gratuito do Radix Dialog).

---

## 🧪 Edge Cases (obrigatório)

- [ ] **Primeiro acesso, nenhuma fonte configurada, fallback ativo:** banner amarelo aparece; convidar admin (Sprint 11) gera link copiável; `email_delivery_log` registra `source='offline_fallback'`.
- [ ] **Primeiro acesso, fallback desativado:** banner vermelho; sender lança `EmailNotConfiguredError`; UI do caller (Sprint 11 invitations) deve mostrar erro tipado e instruir "configure email primeiro".
- [ ] **Vault inacessível** (RPC `get_integration_credential_plaintext` lança erro genérico): sender cai automaticamente para env vars; `email_delivery_log` marca `source='env_var'`. Não bloqueia o envio.
- [ ] **Rotação concorrente:** 2 owners clicam "Rotacionar" ao mesmo tempo. `FOR UPDATE` no RPC garante que só 1 vence; outro recebe `'credential_locked_for_rotation'` e UI mostra "outra rotação em andamento, recarregue".
- [ ] **Revogação durante envio em andamento:** sender pega credencial, transport está em flight, admin revoga. O envio em curso **completa** com a credencial que tinha — Vault `delete_secret` só remove para próximas leituras. `last_used_at` do registro revogado é atualizado mesmo após `revoked_at` (UPDATE em soft-deleted permitido para `last_used_at`).
- [ ] **Secret no Vault deletado fora-de-banda** (operação manual no dashboard): `get_integration_credential_plaintext` lança `vault_secret_missing`; sender cai para env vars. UI lista a credencial como "Vault inconsistente — revogue e recadastre".
- [ ] **Plaintext nunca em response JSON:** validado por testes G-14 acima E por scan estático no Guardian (grep por `secretPlaintext\b.*return` e `vault_secret_id` em `actions/**`).
- [ ] **Hint não permite reconstrução:** `hint='****abc'` para `secretPlaintext='supersecret123abc'` — apenas 4 chars finais; senha de 16 chars expõe < 25%. Spec valida tamanho.
- [ ] **Audit nunca contém plaintext:** Guardian valida via grep que nenhuma chamada a `audit_write` em `admin_create_integration_credential` / `admin_rotate_integration_credential` referencia `p_secret_plaintext` (deve referenciar apenas `hint`, `kind`, `label`).
- [ ] **Tentativa de chamar `get_integration_credential_plaintext` via JWT customer:** rejeitada por privilege check (REVOKE FROM authenticated/anon). Teste integrado ataca a RPC com JWT regular e espera `42501` (insufficient_privilege).
- [ ] **Tentativa de SELECT direto em `vault.decrypted_secrets` via JWT customer:** rejeitada (Supabase Vault REVOKE default). Teste documenta.
- [ ] **Logs de email com retry de transport:** caller que recebe `status='error'` decide reenvio. `email_delivery_log` ganha múltiplas linhas (1 por tentativa) — não há agrupamento aqui. Spec valida que isso não infla audit log (audit só em `offline_fallback`).
- [ ] **Mudança de fonte entre requests:** request A lê via DB (cache hit), credencial é revogada em outro request, request B lê via env var (DB sem credencial ativa). Cache de `getEmailCredential()` é por request — sem stale entre requests.
- [ ] **Banner global causa flash em transições de rota** (RSC re-renderiza shell): aceitar; status é cacheado por request, custo é 1 query DB por navegação. Se virar gargalo medido, mover para `unstable_cache` com tag-based invalidation. Spec lista como follow-up.
- [ ] **Caller passa `related: { type: 'invitation', id }` mas a invitation não existe** (race com revoke): `email_delivery_log` aceita o id mesmo assim (não há FK física, só convenção). Sprint 11 lida com a inconsistência ao consultar logs.

---

## 🚫 Fora de escopo

- **Migração das `invitations` existentes** (`src/lib/actions/invitations.ts` que hoje usa `supabase.auth.admin.inviteUserByEmail`) **para o sender próprio** — fica para **Sprint 11** junto com `platform_admin_invitations`. Aqui só entregamos o `sender.ts` pronto para consumo.
- **Outros tipos de credencial** (SMS Twilio, webhook keys, gateway de pagamento) — `kind` enum aberto, mas só `email_smtp` no MVP. Cada novo `kind` exige migration explícita atualizando o CHECK + spec dedicada (não basta append no enum).
- **UI de visualização do `email_delivery_log`** — fase 2 (audit já cobre eventos críticos via `offline_fallback`). Para o MVP, debug via SQL direto ou MCP.
- **Templates de email transacional** (HTML com branding) — Sprint 11 quando o primeiro caller real (convite admin) chegar. Aqui o sender é genérico (`html`/`text` raw).
- **Retry automático com backoff** em falha de transport — caller decide. Sender retorna erro tipado.
- **Webhook de bounce/complaint do provider SMTP** — fase 2.
- **Rotação automática agendada** (key rotation policy) — operação manual via UI no MVP. Spec lista como follow-up.
- **Métricas agregadas de envio** (taxa de sucesso, latência) — derivável de `email_delivery_log` quando a UI for criada (fase 2).
- **Cifragem de outros campos sensíveis** (PII de customer, API keys de integrações já existentes) — scoped para esta sprint apenas a `platform_integration_credentials.secret`.
- **Suporte a múltiplas credenciais ativas do mesmo `kind`** (ex: 2 SMTPs com round-robin) — UNIQUE parcial força 1 ativa. Multi-tenant routing fica para fase 2.
- **Logs de tentativas de acesso não-autorizado a `get_integration_credential_plaintext`** — cobertos pelo log do Postgres + alertas de oncall (fora do app); não duplicar em `audit_log`.

---

## ⚠️ Critérios de Aceite

- [ ] 2 tabelas novas (`platform_integration_credentials`, `email_delivery_log`) criadas com `FORCE RLS`. Validar:
  ```sql
  SELECT relname, relforcerowsecurity FROM pg_class
   WHERE relname IN ('platform_integration_credentials','email_delivery_log');
  -- esperado: ambas com t
  ```
- [ ] Vault habilitado (`SELECT installed_version FROM pg_extension WHERE extname='supabase_vault'` retorna não-null) — já está, validar que migration não regrediu.
- [ ] RPCs criadas com privilégios corretos:
  ```sql
  -- Admin RPCs: owner/support/billing acessam via Server Action (RLS-bypass com service client). Anon nunca.
  SELECT has_function_privilege('anon', 'public.admin_create_integration_credential(text,text,jsonb,text)', 'execute');  -- false
  SELECT has_function_privilege('anon', 'public.admin_rotate_integration_credential(uuid,text,jsonb)', 'execute');         -- false
  SELECT has_function_privilege('anon', 'public.admin_revoke_integration_credential(uuid)', 'execute');                    -- false
  SELECT has_function_privilege('authenticated', 'public.get_integration_credential_plaintext(text)', 'execute');           -- false
  SELECT has_function_privilege('anon', 'public.get_integration_credential_plaintext(text)', 'execute');                    -- false
  SELECT has_function_privilege('service_role', 'public.get_integration_credential_plaintext(text)', 'execute');            -- true
  SELECT has_function_privilege('service_role', 'public.mark_credential_used(uuid)', 'execute');                            -- true
  SELECT has_function_privilege('service_role', 'public.log_email_delivery(text,text,text,text,text,text,text,text,uuid,uuid)', 'execute'); -- true
  ```
- [ ] **G-14 (plaintext nunca exposto)**: scan automatizado do Guardian em `src/lib/actions/admin/integration-credentials.{ts,schemas.ts}` rejeita PR que (a) faz return de objeto contendo `secretPlaintext`/`password` em qualquer Server Action, (b) loga plaintext em console.*, (c) inclui plaintext em payload de audit. Teste de integration explicitamente faz `JSON.stringify(actionResponse)` e assert que não contém o plaintext literal.
- [ ] **RF-SET-4 (cifragem em repouso)**: `SELECT secret FROM vault.secrets WHERE id=<id_da_credencial>` retorna **bytea cifrada**, não plaintext. Apenas `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id=<id>` (privilegiado) retorna plaintext.
- [ ] **RF-SET-7 (fallback chain)**: testes integrados cobrem os 3 caminhos (`platform_setting`, `env_var`, `offline_fallback`) com inputs determinísticos.
- [ ] **UNIQUE parcial** `(kind) WHERE revoked_at IS NULL` ativa: criar 2 credenciais `email_smtp` sem revogar a primeira → segunda falha com erro tipado `'credential_kind_already_active'`.
- [ ] Toda mutation admin (`create`/`rotate`/`revoke`) grava em `audit_log` com `target_type='platform_integration_credential'`, `target_id` correto, `metadata` contendo `{kind, label, hint}`, e **sem plaintext nem `vault_secret_id`** no `metadata`/`diff_*`. Validar via SQL após teste:
  ```sql
  SELECT diff_after::text NOT LIKE '%supersecret%' FROM audit_log WHERE target_type='platform_integration_credential' ORDER BY occurred_at DESC LIMIT 5;
  -- esperado: todas t
  ```
- [ ] UI `/admin/settings/integrations/email` renderiza sem erro nos 3 estados: nenhuma credencial, credencial ativa, credencial revogada (vazia).
- [ ] Banner global "Email não configurado" aparece quando ambas DB e env vars estão vazias; desaparece quando DB tem credencial ativa (sem reload — ao menos cache invalidation por revalidatePath).
- [ ] RBAC respeitada: owner cria/rotaciona/revoga; support+billing veem lista (read-only — botões mutation ocultos); customer user (JWT regular) recebe 403 ao acessar a rota.
- [ ] `npm run build` passa sem erros (incluindo o build do nodemailer — verificar bundle size se virar regressão).
- [ ] `npm run lint` passa sem novos warnings.
- [ ] **GATE 4.5**: `tests/integration/admin-integration-credentials.test.ts` + `email-sender.test.ts` + `email-source-status.test.ts` passam com 0 falhas, 0 skips.
- [ ] **Guardian aprova o código** (GATE 4) — incluindo verificação:
  1. Nenhum return de Server Action contém `secretPlaintext`/`password`/`vault_secret_id`.
  2. `get_integration_credential_plaintext` é chamada apenas por `src/lib/email/getCredential.ts` (grep autorizado).
  3. `nodemailer` é importado apenas em `src/lib/email/sender.ts` (server-only via `import 'server-only'`).
  4. Nenhum Client Component importa de `src/lib/email/*` (verificado por grep + bundle analysis se possível).
  5. Audit payloads não referenciam plaintext.
- [ ] **GATE 5 estático**: `node scripts/verify-design.mjs --changed` retorna 0 violações.
- [ ] `docs/conventions/audit.md` appendou as 4 ações novas (`integration_credential.create`, `integration_credential.rotate`, `integration_credential.revoke`, `email.delivery_offline_fallback`).
- [ ] `docs/PROJECT_CONTEXT.md` atualizado: §5d registra as 2 tabelas novas, decisão Vault vs pgsodium, lista de privilégios das RPCs sensíveis, e o contrato `EmailDeliveryResult` discriminado.
- [ ] `.env.example` atualizado com `BOOTSTRAP_EMAIL_HOST`, `BOOTSTRAP_EMAIL_PORT`, `BOOTSTRAP_EMAIL_USER`, `BOOTSTRAP_EMAIL_PASSWORD`, `BOOTSTRAP_EMAIL_FROM`, `BOOTSTRAP_EMAIL_SECURE` documentadas (vazias por default; instruções de quando usar).
- [ ] `package.json` ganhou `nodemailer` + `@types/nodemailer` como deps; `npm run build` ainda compila.

---

## 🤖 Recomendação de Execução

**Análise:**
- Nível: STANDARD
- Complexity Score: **22** (cap em 22 para árvore de decisão; ≥9 já força Opção 2)
  - DB: **+8** (2 novas tabelas — `platform_integration_credentials` +3 com UNIQUE parcial e FK lógica para `vault.secrets`, `email_delivery_log` +3, integração com schema externo `vault` +2)
  - API/Actions: **+9** (7 RPCs novas — 3 admin write + 1 plaintext-read service-only + 1 mark-used + 1 log-delivery + 1 list = 7; Server Actions novas — 4 actions admin + 3 helpers email; total ~10 endpoints — +4)
  - UI: **+3** (1 página settings nova + form + dialog + banner global; ~6 componentes novos)
  - Lógica: **+5** (fallback chain DB→env→offline com semântica de retorno discriminada +2, política rigorosa de privilégios para RPC plaintext-only +1, hint masking sem permitir reconstrução +1, decisão Vault vs pgsodium documentada +1)
  - Dependências: **+5** (externa: `nodemailer` SDK novo +3; interna: `audit_write` Sprint 03, `requirePlatformAdminRole` Sprint 02, setting `signup_link_offline_fallback_enabled` Sprint 09 — risco baixo de regressão; Vault como dependência runtime +2)
  - **Total bruto: ~30** (cap em 22 — qualquer ≥9 já força Opção 2)
- Reference Module: **parcial** — Sprints 05/06/07/09 são gold standard para padrão de RPC com audit + Server Action wrapper admin + UI settings page; **sem reference module direto** para integração com Vault (`vault.create_secret` / `vault.decrypted_secrets`), fallback chain de credenciais com semântica multi-source, transport SMTP via nodemailer (primeiro email transacional próprio do projeto).
- Integração com API externa: **sim** — Supabase Vault (interno ao banco mas API distinta) + transport SMTP genérico via nodemailer (qualquer provider). Item 2 da árvore (Integração com API externa → Opção 2 forçada) também dispara.
- Lógica de negócio nova/ambígua: **sim, alta** — pontos críticos:
  - **(a) Cifragem:** Vault vs pgsodium — pré-decisão Vault (já instalado), spec valida e documenta privilege model.
  - **(b) Fallback chain:** ordem das 3 fontes + critério de "configurado" para env vars (HOST setado basta? ou todos os 5 campos?) — spec define.
  - **(c) Sender ownership do `offlineLink`:** caller passa pré-construído ou sender gera signed URL genérica — spec decide.
  - **(d) Hint masking:** tamanho exato (`****abc` últimos 4? últimos 6?) — spec define com base em entropy mínima da credencial.
  - **(e) Privilege model do `get_integration_credential_plaintext`:** `service_role`-only ou role customizada? — spec valida que `service_role` no Server Action é suficiente (mesmo padrão de `admin_create_organization` etc.).
  - **(f) `mark_credential_used` em fire-and-forget:** ok ou aguarda promise? — spec valida que latência adicional do await é aceitável (1 query simples) e elimina race com revoga.
  - **(g) Cache de `getEmailCredential` por request:** React `cache()` ou `unstable_cache` — spec valida que `cache()` simples é suficiente.
  - **(h) Banner global em todas as rotas admin:** custo de 1 query por navegação — aceitar ou cachear cross-request com revalidatePath em mutations? Spec define.
- Ambiguity Risk: **alto** — primeira sprint do projeto a tocar Supabase Vault, primeiro transport SMTP próprio, e a primeira RPC com privilege model `service_role`-only restritivo. Drift em qualquer um dos 8 pontos acima vira retrabalho cascateado para Sprint 11 que vai consumir o sender.

---

### Opção 1 — SIMPLES (sem PRD)
- **Fluxo:** Tech Lead → `@db-admin` → `@backend` → `@qa-integration` → `@frontend+` → `@guardian` → gates → commit
- **PRD:** pulado; sprint file é o contrato
- **Modelo sugerido:** N/A — score ≥9 + integração com API externa (Vault + SMTP) + múltiplas tabelas novas (≥2) **forçam Opção 2** pela rubrica (3 caminhos independentes).
- **Quando faz sentido:** **não faz sentido aqui.** 2 tabelas novas + 7 RPCs + nova dependência runtime (nodemailer) + integração inédita com Vault + 8 decisões de design não-óbvias listadas no Ambiguity Risk + risco G-14 (plaintext leak é incidente de segurança P0). Executar em Sonnet sem cold review do `@spec-writer` resulta em drift garantido — especialmente em (b) ordem do fallback, (e) privilege model, e segurança do hint masking.

### Opção 2 — COMPLETA (com PRD)
- **Fluxo:** Tech Lead → `@spec-writer` (Implementation Plan) → `@sanity-checker` (loop ≤3×) → STOP & WAIT → `@db-admin` → `@backend` → `@qa-integration` → `@frontend+` → `@guardian` → gates → commit
- **PRD:** gerado em `prds/prd_admin_10_credentials_email_bootstrap.md`
- **Modelo sugerido:** **Opus** — cold review do `@spec-writer` + sanity-checker pagam o custo; em Sonnet drifta com 2 tabelas + 7 RPCs + Vault + privilege model novo + 8 decisões de design + risco G-14 alto.
- **Quando faz sentido:** **aqui.** A rubrica força Opção 2 por **três caminhos independentes**: (1) score ≥9 (item 1 da árvore), (2) integração com API externa (item 2 — Vault + SMTP), (3) lógica de negócio nova/ambígua em 8 pontos críticos (item 3). O `@spec-writer` precisa fixar antes do `@db-admin` começar:
  1. **Schema canônico** das 2 tabelas com CHECK constraints, índices, UNIQUE parcial, e a estratégia exata de FK lógica para `vault.secrets`.
  2. **Privilege model exaustivo** das 7 RPCs (quem chama via service_role, quem chama via JWT, quem nunca chama).
  3. **Contrato do `EmailDeliveryResult`** discriminado — type literal completo + comportamento do caller para cada `status`.
  4. **Decisão (c) sobre ownership do `offlineLink`** — caller passa ou sender gera; spec valida que invitations Sprint 11 já tem token, então caller passa = `offlineLink = appUrl + '/admin/accept-invite/' + token`.
  5. **Snippet canônico de transport SMTP** com nodemailer — padrão para fase 2 (Resend, SES) seguir.
  6. **Estratégia de mock** dos integration tests — como simular `vault.decrypted_secrets`, como mockar nodemailer transport, como assertar G-14 (plaintext nunca em response).
  7. **Plano de validação G-14** — lista exaustiva de pontos onde plaintext poderia vazar (Server Action return, audit payload, log do Postgres, console.log de dev) + grep guards para o Guardian.
  8. **Reconciliação com `rbac_matrix.md`** — owner mutation + support read + billing read; o sender em si é service-role-only (chamado por Server Actions já validadas, não diretamente pelo customer).
  9. **Decisão (h) sobre cache do banner global** — começar simples (cache por request) e listar como follow-up se virar gargalo medido.

---

**Recomendação do @sprint-creator:** **Opção 2 — Opus** (forçada pela rubrica em 3 caminhos)

**Justificativa:**
Score ≥9 dispara item 1 da árvore. Integração com API externa (Supabase Vault + SMTP) dispara item 2. Lógica de negócio nova/ambígua em 8 pontos dispara item 3. Esta é a **primeira sprint de cifragem em repouso** do projeto e **primeira a usar privilege model `service_role`-only** — qualquer drift em (e) privilégios ou (b) ordem do fallback gera incidente de segurança classe G-14 (plaintext leak). O `@spec-writer` precisa fixar privilege model, schema do `EmailDeliveryResult`, e snippet canônico de transport antes do `@db-admin` mexer no Vault. Sprint 11 (CRUD platform admins + convite email) depende deste sender estar pronto e testado — drift aqui custa também o Sprint 11. O `@sanity-checker` valida contra RF-SET-4, RF-SET-7, G-14, INV-6 do PRD admin.

**Aguardando escolha do usuário:** responda ao Tech Lead com `"execute opção 2"` (recomendado) ou `"execute"` (aceita a recomendação). Opção 1 não é adequada aqui — a rubrica força Opção 2 por três caminhos independentes.

---

## 🔄 Execução

> Esta seção é preenchida durante a execução. Cada agente atualiza sua linha antes de reportar conclusão ao Tech Lead. O Tech Lead atualiza a linha do `@guardian` e a linha Git no encerramento.

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| PRD Técnico (Implementation Plan) | `@spec-writer` | ✅ Concluído | `prds/prd_admin_10_credentials_email_bootstrap.md` |
| Sanity Check | `@sanity-checker` | ✅ Concluído | APROVADO (1ª iteração após quick-fix browser/env) |
| Banco de dados | `@db-admin` | ✅ Concluído | `supabase/migrations/20260427200000_admin_10_credentials_email_bootstrap.sql` (aplicada manual; GATE 1 ✅) |
| Server Actions + helpers email | `@backend` | ✅ Concluído | `src/lib/email/{getCredential,sender,getEmailSourceStatus}.ts` · `src/lib/actions/admin/integration-credentials.{ts,schemas.ts}` · `.env.example` · `package.json` (+nodemailer) — GATE 2 ✅ |
| Integration tests | `@qa-integration` | ✅ Concluído | `tests/integration/admin-integration-credentials.test.ts` (15) · `email-sender.test.ts` (10) · `email-source-status.test.ts` (6) — 31 testes, 0 falhas, 0 skips. GATE 4.5 ✅ |
| Frontend | `@frontend+` | ✅ Concluído | `src/app/admin/settings/integrations/email/page.tsx` · `src/components/admin/settings/integrations/{IntegrationCredentialStatusCard,IntegrationCredentialForm,RevokeCredentialDialog}.tsx` · `src/components/admin/EmailSourceBanner.tsx` · `AdminShell.tsx` (banner acima do topbar) · `AdminSidebar.tsx` (subitem Integrações · Email). GATE 2 ✅ · GATE 5 estático ✅ (7 arquivos, 0 violações). |
| Guardian | `@guardian` | ✅ Concluído | `sprints/handoffs/sprint_admin_10_credentials_email_bootstrap/guardian_result.md` — APROVADO em agent mode (1ª tentativa). GATE 4 ✅. AGENT-DRIFT 2026-04-21+2026-04-20 não se repetiu (`<button` inline grep retornou 0 nos paths do sprint). |
| Git | Tech Lead | ▶️ Em andamento | — |

**Legenda:** ⬜ Pendente · ▶️ Em andamento · ✅ Concluído · ⏸️ Aguarda review · n/a — não aplicável
