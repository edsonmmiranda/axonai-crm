# 05 — Roadmap de Sprints

## Visão geral

| # | Sprint | Target app | Nível | Dependências | Esforço |
|---|---|---|---|---|---|
| S0 | Framework adjustments | shared | LIGHT | — | ~45 min |
| S1 | DB Foundation | admin (schema) | STANDARD | S0 | 1 sessão |
| S2 | Admin shell + auth | admin | STANDARD | S1 | 1-2 sessões |
| S3 | Customer impersonation support | customer | STANDARD | S1 | 1 sessão |
| S4 | Organizations module | admin | STANDARD | S1, S2, S3 | 1-2 sessões |
| S5 | Plans module | admin | STANDARD | S1, S2 | 1 sessão |
| S6 | Subscriptions module | admin | STANDARD | S4, S5 | 1-2 sessões |
| S7 | Platform admins + Audit log | admin | STANDARD | S1, S2 | 1 sessão |
| S8 | Platform settings | admin | STANDARD | S2 | 1-2 sessões |
| S9 | Dashboard metrics v1 | admin | LIGHT | S4, S6 | curta |

**Total:** 9 sprints após o S0. Em cadência de 1 sprint/semana, ~2 meses. Fase 2 (billing com Stripe, impersonation avançada, métricas ricas) vem depois e não está estimada aqui.

## Grafo de dependências

```
S0 ──► S1 ──┬──► S2 ──┬──► S4 ──┐
            │         │         ├──► S6 ──► S9
            │         └──► S5 ──┘
            │         │
            │         ├──► S7
            │         │
            │         └──► S8
            │
            └──► S3 ──► S4 (S4 também depende de S3)
```

S0 desbloqueia tudo. S1 + S2 são o "cérebro" — depois disso, a maior parte do trabalho pode acontecer em ordens variadas.

---

## S0 — Framework adjustments

**Target app:** shared
**Nível:** LIGHT
**Dependências:** —

**Escopo:** especificado em detalhe no [04-mudancas-framework.md](./04-mudancas-framework.md).

Resumo:
- Atualizar `docs/conventions/standards.md` com seção "Admin Area"
- Atualizar `docs/conventions/security.md` com seção "Platform Admin Area"
- Adicionar regras ESLint `no-restricted-imports`
- Atualizar `@backend` com padrão de Server Action admin
- Atualizar `@guardian` com checklist para código `(admin)/`
- Atualizar template de sprint + `@sprint-creator` com campo `Target app`
- (Opcional) Ajustar `scripts/verify-design.mjs` se necessário

**Critérios de aceite:**
- `npm run lint` passa
- `npm run build` passa
- Nenhum sprint concluído (`sprints/done/`) é alterado
- Commit único no estilo `chore(framework): prepare for admin area`

---

## S1 — DB Foundation

**Target app:** admin (schema)
**Nível:** STANDARD
**Dependências:** S0

**Escopo:** criar o schema completo da área admin. Especificação em [02-schema-banco.md](./02-schema-banco.md).

**Entregáveis:**

1. Migration SQL em `supabase/migrations/<timestamp>_admin_area_foundation.sql` criando:
   - `platform_admins` (+ indexes + RLS DENY ALL)
   - `plans` (+ indexes + RLS SELECT público)
   - `subscriptions` (+ indexes + RLS customer-read)
   - `impersonation_sessions` (+ indexes + RLS + trigger immutability)
   - `platform_audit_log` (+ indexes + RLS + trigger append-only)
   - `platform_settings` (+ RLS + seed singleton)
   - `platform_integration_credentials` (+ RLS)
   - Função `is_platform_admin(uuid)` (SECURITY DEFINER)
2. Seed de planos iniciais: `free`, `starter`, `pro`
3. Backfill de `subscriptions` a partir de `organizations.plan` existente
4. Atualização de `docs/schema_snapshot.json` com as 7 tabelas novas
5. Script/instrução para criar o primeiro `platform_admin` (owner) manualmente via SQL (owner é Edson Miranda — email definido no momento da execução)

**Critérios de aceite:**
- GATE 1 (dry-run) passa: `supabase db push --dry-run` sem erros
- Todas as 7 tabelas têm RLS habilitada
- Trigger de immutability funciona (teste manual: tentar UPDATE em `platform_audit_log` → erro)
- `schema_snapshot.json` atualizado com novas tabelas
- Seed de `plans` inserido com 3 planos ativos
- `subscriptions` populado com uma linha por organization existente

**Agentes:** `@db-admin`
**Gates:** 1 (DB), 4 (Guardian)

---

## S2 — Admin shell + auth

**Target app:** admin
**Nível:** STANDARD
**Dependências:** S1

**Escopo:** criar a casca da área admin — roteamento, login dedicado, middleware, layout base.

**Entregáveis:**

1. Estrutura de pastas `src/app/(admin)/` com layout e dashboard vazio
2. `src/app/(auth)/admin-login/page.tsx` — login com MFA TOTP
3. `src/middleware.ts` atualizado para reconhecer `/admin/*` e aplicar `assertPlatformAdmin` logic (verificação básica — a asserção forte fica nas Server Actions)
4. Helpers:
   - `src/lib/supabase/service-role.ts` — factory de client
   - `src/lib/admin/guards.ts` — `assertPlatformAdmin()`
   - `src/lib/admin/audit.ts` — `logAdminAction()`
   - `src/lib/admin/impersonation.ts` — `sign/verifyImpersonationToken()` (só signing — consumo fica no S3/S4)
5. `AdminLayout` (`src/app/(admin)/layout.tsx`) — sidebar distinta, topbar com identificação do admin logado
6. `AdminSidebar` e `AdminTopbar` em `src/components/admin/`
7. Dashboard home placeholder em `src/app/(admin)/dashboard/page.tsx` (3 cards de KPI com "—" de valor — preenchidos no S9)
8. Env var `IMPERSONATION_SECRET` documentada em `.env.example` (64 bytes random)

**Critérios de aceite:**
- GATE 2 (build + lint) passa
- Usuário não logado em `/admin/*` → redirect para `/admin-login`
- User logado sem `platform_admins` ativo → redirect para `/admin-login?err=not_admin`
- User logado sem MFA → força enrollment
- Layout admin tem identidade visual distinta do customer (confirmada manualmente no GATE 5 via Gold Standard)
- ESLint proíbe cross-imports (teste: importar `(app)/` de `(admin)/` → erro)

**Agentes:** `@backend`, `@frontend+`, `@guardian`
**Gates:** 2, 4, 5

---

## S3 — Customer impersonation support

**Target app:** customer
**Nível:** STANDARD
**Dependências:** S1

**Escopo:** preparar o customer app para receber e exibir sessões de impersonation iniciadas pelo admin. Fluxo detalhado em [01-arquitetura.md](./01-arquitetura.md) seção "Fluxo de impersonation".

**Entregáveis:**

1. Endpoint `src/app/api/impersonation/start/route.ts`:
   - Recebe token HMAC via query
   - Valida assinatura + exp + nonce (single-use)
   - Verifica `impersonation_sessions` existe e está `active`
   - Cria sessão Supabase como target user via admin API
   - Seta cookie marker `impersonation_active=1` + `impersonation_session_id=<uuid>`
   - Redirect `/dashboard`
2. Endpoint `src/app/api/impersonation/end/route.ts`:
   - Lê cookie `impersonation_session_id`
   - UPDATE `impersonation_sessions` → `ended_at = now`, `status = 'ended'`
   - Limpa cookies
   - Redirect para origem admin (ou `/login`)
3. Middleware do customer detecta cookie `impersonation_active` e:
   - Valida que a session ainda está ativa no DB
   - Se expirou → força logout
4. Componente `<ImpersonationBanner />` em `src/components/admin-impersonation/`:
   - Renderizado pelo `AppLayout` quando cookie detectado
   - Texto: "⚠️ Você está visualizando como [User] da org [Org] — admin: [Admin]"
   - Botão "Sair da impersonation" → chama `/api/impersonation/end`
   - Sticky top, warning color do design system, **não dismissível**
5. Bloquear ações sensíveis durante impersonation:
   - Alterar senha do próprio user → mensagem "Bloqueado durante impersonation"
   - Alterar email → idem
   - Desenrollar MFA → idem
6. Audit: endpoints chamam `logAdminAction('impersonation.start')` e `impersonation.end`

**Critérios de aceite:**
- GATE 2 (build + lint) passa
- Teste manual: gerar token manualmente via SQL + rota GET → sessão impersonation funciona
- Banner aparece em todas as rotas do customer durante impersonation
- TTL de 30min respeitado (expiração força logout)
- Ações de senha/email bloqueadas durante impersonation
- `impersonation_sessions` registra start e end corretamente

**Agentes:** `@backend`, `@frontend+`, `@guardian`
**Gates:** 2, 4

---

## S4 — Organizations module (admin)

**Target app:** admin
**Nível:** STANDARD
**Dependências:** S1, S2, S3

**Escopo:** primeira feature completa da área admin — gerenciar empresas-clientes.

**Entregáveis:**

1. `src/app/(admin)/organizations/page.tsx` — list com filtros:
   - Por plano (`plans.slug`)
   - Por status (`is_active`)
   - Por data de criação (range)
   - Busca textual por nome/slug
   - Paginação server-side
2. `src/app/(admin)/organizations/[id]/page.tsx` — detalhe:
   - Dados da org (nome, slug, plan atual, created_at)
   - Lista de users da org (query em `profiles`)
   - Uso: total de leads, products, funnels
   - Subscription atual (plan, status, trial_ends_at)
   - Histórico de audit log filtrado por essa org
   - Botão "Suspender" / "Ativar"
   - Botão "Impersonar user X" (por user da org)
3. `src/app/(admin)/organizations/[id]/actions.ts`:
   - `suspendOrganization(orgId, reason)` — UPDATE + audit
   - `activateOrganization(orgId)` — UPDATE + audit
   - `updateOrganization(orgId, data)` — UPDATE + audit
   - `startImpersonation(targetUserId, reason)` — gera token, cria `impersonation_sessions` row, retorna URL do endpoint customer
4. Componentes locais em `_components/`:
   - `OrganizationsTable`
   - `OrganizationDetailCard`
   - `OrganizationUsersList` (com botão impersonar por user)
   - `OrganizationUsageStats`
   - `ImpersonateModal` (com campo "motivo" obrigatório)

**Critérios de aceite:**
- GATE 2, 4, 5 passam
- Todas as Server Actions começam com `assertPlatformAdmin()`
- Todas as mutações chamam `logAdminAction`
- Impersonation funcional end-to-end (admin → customer → banner → encerra → volta admin)
- Filtros e busca funcionam corretamente
- Layout segue design system

**Agentes:** `@backend`, `@frontend+`, `@guardian`
**Gates:** 2, 4, 5

---

## S5 — Plans module (admin)

**Target app:** admin
**Nível:** STANDARD
**Dependências:** S1, S2

**Escopo:** CRUD de planos de assinatura.

**Entregáveis:**

1. `src/app/(admin)/plans/page.tsx` — list ordenado por `display_order`
2. `src/app/(admin)/plans/new/page.tsx` — form de criação
3. `src/app/(admin)/plans/[id]/page.tsx` — edit form
4. `src/app/(admin)/plans/actions.ts`:
   - `createPlan(data)` — INSERT + audit
   - `updatePlan(id, data)` — UPDATE + audit
   - `deactivatePlan(id)` — UPDATE `is_active = false` + audit (soft delete; hard delete requer confirmação extra)
   - `deletePlan(id)` — DELETE + audit (só se não tiver subscriptions ativas)
5. UI de configuração de features (jsonb):
   - Editor de chave/valor ou checkboxes para features conhecidas
   - Campos: `whatsapp_integration`, `advanced_reports`, `funnels`, etc (lista extensível)
6. Preview de como o plano aparece para o cliente (opcional visual)

**Critérios de aceite:**
- GATE 2, 4, 5 passam
- Slug é único (unique constraint + validação Zod)
- Preço aceita zero (Free tier)
- Features jsonb editável sem erro
- Plano com subscriptions ativas não pode ser deletado (apenas desativado)

**Agentes:** `@backend`, `@frontend+`, `@guardian`
**Gates:** 2, 4, 5

---

## S6 — Subscriptions module (admin)

**Target app:** admin
**Nível:** STANDARD
**Dependências:** S4, S5

**Escopo:** gerenciar assinaturas — ver quem tem que plano, trocar, estender, cancelar.

**Entregáveis:**

1. `src/app/(admin)/subscriptions/page.tsx` — list filtrado por status, plano, org
2. `src/app/(admin)/subscriptions/[id]/page.tsx` — detalhe:
   - Org, plano, status, período atual, trial
   - Histórico de mudanças (audit log filtrado)
   - Ações: trocar plano, estender trial, cancelar, reativar
3. `src/app/(admin)/subscriptions/actions.ts`:
   - `assignSubscription(orgId, planId, options)` — INSERT + audit (`subscription.assign`)
   - `changeSubscriptionPlan(subId, newPlanId, options)` — UPDATE + audit (`subscription.change_plan`)
   - `extendTrial(subId, extraDays)` — UPDATE + audit (`subscription.extend_trial`)
   - `cancelSubscription(subId, reason)` — UPDATE `status=canceled` + `canceled_at=now` + audit
   - `reactivateSubscription(subId)` — UPDATE para reativar + audit
4. Modal para trocar plano com:
   - Dropdown de planos disponíveis
   - Confirmação mostrando diff de limites
   - Campo para "motivo" obrigatório

**Critérios de aceite:**
- GATE 2, 4, 5 passam
- Constraint UNIQUE por org (ativa) respeitada — não cria segunda subscription ativa
- Histórico de mudanças rastreável via audit log
- Trocar plano atualiza `current_period_*` corretamente

**Agentes:** `@backend`, `@frontend+`, `@guardian`
**Gates:** 2, 4, 5

---

## S7 — Platform admins + Audit log (admin)

**Target app:** admin
**Nível:** STANDARD
**Dependências:** S1, S2

**Escopo:** gerenciar outros super admins e visualizar o audit log.

**Entregáveis:**

1. `src/app/(admin)/admins/page.tsx` — list de platform admins
2. `src/app/(admin)/admins/new/page.tsx` — form criar admin:
   - Email, nome, role
   - Envia invite via Supabase auth (signInWithOtp ou similar)
   - Força MFA no primeiro login
3. `src/app/(admin)/admins/[id]/page.tsx` — edit/deactivate
4. `src/app/(admin)/admins/actions.ts`:
   - `createPlatformAdmin(data)` — cria `auth.users` + `platform_admins`, envia invite, audit
   - `updatePlatformAdmin(id, data)` — UPDATE + audit
   - `deactivatePlatformAdmin(id)` — UPDATE `is_active = false` + audit (hard delete via SQL manual para casos extremos)
5. `src/app/(admin)/audit-log/page.tsx` — visualização:
   - Filtros: admin, action, target_type, período
   - Paginação server-side
   - Detalhe expansível do `metadata` (jsonb formatado)
6. Restrições:
   - Admin com role `owner` é o único que pode criar outros `owner`s
   - Admin não pode desativar a si mesmo
   - Último owner ativo não pode ser desativado (proteção contra lockout)

**Critérios de aceite:**
- GATE 2, 4, 5 passam
- Fluxo de invite funcional (email chega, MFA enrollment ok)
- Audit log exibe entradas corretamente
- Não é possível executar operações que causariam lockout do sistema

**Agentes:** `@backend`, `@frontend+`, `@guardian`
**Gates:** 2, 4, 5

---

## S8 — Platform settings (admin)

**Target app:** admin
**Nível:** STANDARD
**Dependências:** S2

**Escopo:** configurações globais do SaaS.

**Entregáveis:**

1. `src/app/(admin)/platform-settings/page.tsx` — hub com links para sub-áreas
2. `src/app/(admin)/platform-settings/features/page.tsx` — editor de feature flags por plano:
   - Tabela de planos × features
   - Toggles
   - Save persiste em `platform_settings.feature_flags`
3. `src/app/(admin)/platform-settings/trial/page.tsx` — defaults de trial:
   - Dias de trial, max_users, max_leads
4. `src/app/(admin)/platform-settings/integrations/page.tsx` — credenciais cifradas:
   - Stripe (secret_key, publishable_key, webhook_secret)
   - SMTP (host, port, user, password, from)
   - WhatsApp API (api_key, phone_id)
   - UI mostra apenas se está "configurado" / "não configurado"; valores aparecem mascarados (••••)
   - Edit abre modal separado com aviso "alterar credencial invalida sessões atuais"
5. `src/app/(admin)/platform-settings/policies/page.tsx` — políticas de uso:
   - Retention days (leads, audit_log)
   - Rate limit API
   - Max upload size
6. Helpers em `src/lib/admin/encryption.ts` (se Opção B de cifragem):
   - `encryptCredential(value)` / `decryptCredential(ciphertext)`
   - Usa env var `PLATFORM_ENCRYPTION_KEY`
7. `src/app/(admin)/platform-settings/actions.ts`:
   - `updateFeatureFlags(flags)` + audit
   - `updateTrialDefaults(data)` + audit
   - `updateIntegrationCredential(integration, credentials)` + audit (cifragem antes de persistir)
   - `updatePolicies(data)` + audit

**Critérios de aceite:**
- GATE 2, 4, 5 passam
- Credenciais sensíveis nunca aparecem em plaintext em logs ou UI de listagem
- Feature flags são respeitadas em runtime (ex: módulo WhatsApp desabilitado para plano Free → user customer não vê o módulo) — esta integração é parcial no S8; completar se necessário em sprint seguinte
- Rotação de credencial gera audit log

**Agentes:** `@backend`, `@frontend+`, `@guardian`
**Gates:** 2, 4, 5

**Nota sobre feature flags em runtime:** propagar feature flags para o customer app requer um helper shared (ex: `src/lib/features.ts` com `isFeatureEnabled(orgId, feature)`) que consulta `platform_settings.feature_flags` via cache. Esta parte pode ser deixada para um **S8.1** se o S8 ficar grande.

---

## S9 — Dashboard metrics v1

**Target app:** admin
**Nível:** LIGHT
**Dependências:** S4, S6

**Escopo:** substituir os placeholders do dashboard home pelos 3 KPIs reais.

**Entregáveis:**

1. `src/app/(admin)/dashboard/page.tsx` atualizado:
   - Card "Organizations ativas" — `count(*) from organizations where is_active = true`
   - Card "Usuários totais" — `count(*) from profiles where is_active = true`
   - Card "Leads totais" — `count(*) from leads where is_active = true`
2. Cada card mostra:
   - Valor numérico grande
   - Label
   - (Opcional v1) Comparação com mês anterior — pular se complicar

**Critérios de aceite:**
- GATE 2 passa
- Cards renderizam valores corretos (validar manualmente cruzando com SQL direto no banco)
- Performance: página carrega em < 1s com banco atual

**Agentes:** `@backend` (para as queries), `@frontend+` (para o layout)
**Gates:** 2, 4, 5

---

## Fase 2 — fora do MVP (roadmap futuro)

Não executar agora. Registrar aqui para histórico.

| Sprint | Escopo resumido |
|---|---|
| S10 — Stripe integration | Tabelas `invoices` e `payment_methods`. Webhook Stripe. Sincronização bidirecional subscription ↔ Stripe customer. Emissão de invoices automáticas. |
| S11 — Dashboard metrics avançado | MRR, churn rate, LTV, cohort analysis, gráficos de evolução. Pode exigir materialized views. |
| S12 — Support tickets | Sistema de chamados integrado — customer abre, admin responde. |
| S13 — Feature flags enforcement | Helper global `isFeatureEnabled(orgId, feature)` com cache, integração em todos os módulos customer. |
| S14 — Alertas automáticos | Quota excedida, risco de churn, inatividade. Edge function agendada. |
| S15 — Impersonation avançada | Gravação da sessão, replay, lista de impersonations ativas em tempo real. |

## Como o Tech Lead deve gerar os sprint files

Ao executar cada sprint:

1. **Tech Lead** recebe do usuário: `"Tech Lead, executar Sprint <N> da admin area"` ou similar.
2. **Tech Lead** lê este documento + o doc do tópico específico (ex: S1 → ler também `02-schema-banco.md`).
3. **Tech Lead** delega para `@sprint-creator` gerar `sprints/active/sprint_S<N>_<nome>.md` seguindo o template do framework.
4. `@sprint-creator` preenche:
   - Header com `**Nível:**` e `**Target app:**`
   - Seção "Escopo" copiando os entregáveis deste roadmap
   - Seção "Critérios de aceite" copiando os critérios
   - Seção "🤖 Recomendação de Execução" com Opção 1 ou 2 baseado na complexidade
   - Seção "🔄 Execução" com tabela de progresso
5. **Tech Lead** apresenta ao usuário e aguarda `"execute"` ou escolha explícita de opção.

## Notas importantes

- **Sprints podem crescer em escopo conforme execução real.** Se um sprint ficar grande demais, dividir em S<N>.1 e S<N>.2. Registrar a decisão em `docs/APRENDIZADOS.md`.
- **Dependências estritas** (S1 antes de S2 etc) não devem ser violadas — causa retrabalho.
- **Dependências fracas** (S5 pode vir antes de S4 se o PO preferir) são ok — mas atenção a dependências implícitas no código.
- **Todos os sprints respeitam o checkpoint pós-@frontend+** do framework (pausar antes do @guardian — ver memória do usuário `feedback_checkpoint_pause.md`).
