# Sprint admin_14: Toggle global de obrigatoriedade de MFA para administradores (STANDARD)

> **Nível:** STANDARD
> **Origem:** [docs/admin_area/planejamento_sprint_admin_14.md](../../docs/admin_area/planejamento_sprint_admin_14.md)

---

## 🎯 Objetivo de Negócio

Hoje a obrigatoriedade de MFA (aal2) para acesso a `/admin/*` é hard-coded em [src/middleware.ts:180-187](../../src/middleware.ts#L180-L187). Não há forma de relaxar essa exigência sem alterar código e fazer deploy.

Este sprint expõe esse comportamento como uma **feature flag global** chamada `require_admin_mfa`, controlável pelo `owner` da plataforma a partir da página existente [/admin/settings/feature-flags](../../src/app/admin/settings/feature-flags/page.tsx). A flag tem `defaultEnabled: true` (default seguro: ambientes recém-deployados continuam protegidos automaticamente). O toggle herda mutação owner-only e audit log com IP/UA já implementados pela RPC `admin_set_feature_flag`.

**Métrica de sucesso:** owner consegue ligar/desligar MFA admin sem deploy, com audit log completo e sem regredir o forçamento de re-enroll do Sprint 11 (`profiles.mfa_reset_required`).

## 👤 User Stories

- Como **owner da plataforma**, eu quero desligar a obrigatoriedade de MFA para todos os admins quando estou avaliando o ambiente em fase inicial, para que admins recém-criados consigam entrar antes de configurarem o fator TOTP.
- Como **owner da plataforma**, eu quero religar a obrigatoriedade de MFA quando o ambiente estiver pronto para produção, para restaurar o comportamento padrão sem deploy.
- Como **admin não-owner**, eu quero **não conseguir** alterar essa flag (UI desabilitada e RPC bloqueia), para que decisões de política da plataforma fiquem centralizadas no owner.
- Como **owner da plataforma**, ao desligar a flag eu quero ver um modal explicando o impacto antes de confirmar, para evitar desligamento acidental por clique em Switch.

## 🎨 Referências Visuais

- **Layout:** página existente [/admin/settings/feature-flags](../../src/app/admin/settings/feature-flags/page.tsx) renderizada via `AdminShell`. Sem mudança de layout — apenas adição de modal disparado pelo Switch.
- **Design system:** componentes compostos de `src/components/ui/`. Modal usa `AlertDialog` (shadcn) com tokens semânticos (`bg-feedback-warning-*` ou `bg-feedback-danger-*` para destacar o impacto). Nada de hex.
- **Componentes:** `Switch` (existente em `FeatureFlagsList`), `AlertDialog` (`AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel`).
- **Gold Standard:** [src/components/admin/settings/FeatureFlagsList.tsx](../../src/components/admin/settings/FeatureFlagsList.tsx) — extender o toggle direto para interceptar quando a flag é `require_admin_mfa` indo de on → off.

## 🧬 Reference Module Compliance

**Não aplicável** — este sprint não cria novo módulo CRUD. Reaproveita integralmente:

- Registry: [src/lib/featureFlags/registry.ts](../../src/lib/featureFlags/registry.ts) (adiciona uma chave)
- Action: [src/lib/actions/admin/feature-flags.ts](../../src/lib/actions/admin/feature-flags.ts) (sem mudança — já cobre owner-only + audit IP/UA)
- UI: [src/components/admin/settings/FeatureFlagsList.tsx](../../src/components/admin/settings/FeatureFlagsList.tsx) (estende `handleToggle` para interceptar `require_admin_mfa` em desligamento)
- Middleware: [src/middleware.ts](../../src/middleware.ts) (gate antes do bloco aal2)

## 📋 Funcionalidades (Escopo)

### Backend

- [ ] **Banco de Dados (validação, sem nova tabela):**
  - `@db-admin` valida que a tabela `feature_flags` permite **SELECT autenticado** (necessário para o middleware ler a flag em todo request `/admin/*`). Se a RLS atual restringir leitura a `owner` ou outro perfil, criar uma **RPC dedicada `get_require_admin_mfa()` SECURITY DEFINER** que retorna `boolean` consultando `feature_flags` + fallback para `defaultEnabled`. A escolha entre "ler tabela direto" vs "RPC dedicada" fica com o `@db-admin` baseado no estado real das policies — qualquer caminho é aceitável desde que: (a) middleware consiga obter o valor, (b) leitura não exponha outras flags ao middleware sem necessidade, (c) audit log de mutação continua intacto via `admin_set_feature_flag`.
  - **Sem migration de dados:** `defaultEnabled: true` no registry garante comportamento seguro para ambientes sem linha persistida. Sem backfill.

- [ ] **Registry de feature flags:**
  - Adicionar entrada em [src/lib/featureFlags/registry.ts](../../src/lib/featureFlags/registry.ts):
    ```ts
    {
      key: 'require_admin_mfa',
      label: 'Exigir MFA para administradores',
      description: 'Quando ligado, todo admin deve completar MFA (aal2) para acessar /admin/*. Desligar reduz a barreira de segurança.',
      isPublic: false,
      defaultEnabled: true,
    }
    ```
  - Sem outras alterações no registry.

- [ ] **Helper de leitura para middleware:**
  - Novo arquivo: `src/lib/featureFlags/getRequireAdminMfa.ts`
  - Função: `getRequireAdminMfaCached(supabase): Promise<boolean>`
  - **Cache:** módulo-level com TTL **30s** (variável `let cached: { value: boolean; expiresAt: number } | null = null`). Não usa `unstable_cache` (middleware não tem hook idiomático para `revalidateTag`).
  - **Fail-safe:** qualquer erro de leitura (timeout, RLS bloqueia, RPC falha) → retorna `true` (MFA exigido). Erro é logado via `console.error('[mw:require_admin_mfa]', err)` mas **nunca** propaga — middleware não pode quebrar request por falha de feature flag.
  - **Não exporta** o cache. Sem invalidação manual — TTL natural cobre o staleness aceitável (até 30s, conforme critério §6 do brief).

- [ ] **Integração no middleware:**
  - Em [src/middleware.ts](../../src/middleware.ts), inserir verificação **antes** do bloco aal2 (linha 180):
    ```ts
    if (isAdminRoute && !isAdminPublic) {
      if (!user) { /* ... redirect existente para /admin/login ... */ }

      // ── NOVO: gate de obrigatoriedade global ──────────────────────────────
      const mfaRequired = await getRequireAdminMfaCached(supabase);

      if (mfaRequired) {
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal?.currentLevel !== 'aal2') {
          // ... redirect existente para mfa-challenge ou mfa-enroll ...
        }
      }

      // ── PRESERVADO: re-enroll forçado per-admin (Sprint 11) ───────────────
      // mfa_reset_required continua sendo verificado SEMPRE, independente da flag.
      const { data: profile } = await supabase
        .from('profiles')
        .select('mfa_reset_required')
        .eq('id', user.id)
        .maybeSingle();

      if (profile?.mfa_reset_required) {
        // ... redirect existente para mfa-enroll?reenroll=true ...
      }
    }
    ```
  - **Não alterar:**
    - `ADMIN_PUBLIC_PATHS` (rotas isentas continuam isentas).
    - Bloco `mfa_reset_required` (Sprint 11) — fica fora do `if (mfaRequired)` para preservar regressão proibida (§4.5 e §6 do brief).
    - Comportamento de `/dashboard/*` (clientes finais não são afetados).

- [ ] **Server Actions:** **nenhuma nova**. A action [setFeatureFlagAction](../../src/lib/actions/admin/feature-flags.ts) existente já cobre owner-only + audit log. Toggle do registry novo passa por ela automaticamente.

### Frontend

- [ ] **Modificação de [FeatureFlagsList](../../src/components/admin/settings/FeatureFlagsList.tsx):**
  - Detectar quando o toggle é da flag `require_admin_mfa` indo de **on → off** (transição de desativação).
  - Quando detectado: **interceptar antes de chamar `setFeatureFlagAction`** e abrir um `AlertDialog` com:
    - Título: "Desligar MFA obrigatório para administradores?"
    - Descrição (texto de impacto, `@frontend+` ajusta a copy seguindo voice/tone do design system, mas o conteúdo deve incluir):
      - "Admins sem fator TOTP configurado passarão a entrar com aal1 (sem segundo fator)."
      - "Admins com `mfa_reset_required` continuam sendo forçados a re-enroll (Sprint 11) — esta regra não é afetada."
      - "Esta ação fica registrada no audit log com IP e User-Agent."
    - Botões:
      - Cancelar (variant secondary) — fecha o modal sem mudar a flag, faz rollback do estado otimista.
      - Confirmar (variant destructive) — chama `setFeatureFlagAction({ key: 'require_admin_mfa', enabled: false })` e fecha o modal.
  - **Religar (off → on)** **não** abre modal — toggle direto, igual ao comportamento atual da lista.
  - **Outras flags** continuam com toggle direto (sem modal). O modal é específico para `require_admin_mfa` em desativação.
  - **`canMutate = false`** (admin não-owner): Switch desabilitado, modal nunca abre. Comportamento existente.

- [ ] **Sem novas rotas, sem mudanças em `Sidebar`, sem novos layouts.**

## 🧪 Edge Cases

- [ ] **Não-owner tenta desligar:** Switch desabilitado na UI (`canMutate=false`). Mesmo se chamar a action manualmente, RPC `admin_set_feature_flag` bloqueia com `unauthorized`.
- [ ] **Owner cancela o modal:** estado otimista do Switch faz rollback (volta para `enabled=true`). Nenhuma chamada para a Server Action é feita.
- [ ] **Admin com `mfa_reset_required = true` + flag desligada:** o bloco de re-enroll roda **incondicionalmente** — admin é forçado a `/admin/mfa-enroll?reenroll=true`. Regressão proibida (§6 do brief).
- [ ] **Admin sem fator MFA + flag desligada:** acessa `/admin/dashboard` direto após login. Comportamento esperado.
- [ ] **Admin com fator MFA + flag desligada:** **pula** o desafio aal2 — entra com aal1 mesmo tendo fator. Pode optar por step-up manual depois (rotas `/admin/mfa-enroll` e `/admin/mfa-challenge` continuam acessíveis).
- [ ] **Linha de `feature_flags` ausente para `require_admin_mfa`:** middleware lê → fallback `defaultEnabled = true` → MFA exigido (default seguro). Sem necessidade de backfill.
- [ ] **Erro ao ler flag no middleware** (timeout, RPC quebra, RLS rejeita): fail-safe = `true` (MFA exigido). `console.error` registra mas request prossegue.
- [ ] **Cache stale após toggle:** até 30s de staleness em cada Edge instance — aceitável pelo critério §6 do brief. Owner sabe que mudança não é instantânea por instance.
- [ ] **Toggle concorrente (dois owners simultâneos):** RPC do Supabase resolve serialmente. Último write vence. Audit log registra ambos os eventos com IP/UA distintos.
- [ ] **Default em ambiente novo (greenfield):** sem linha em `feature_flags` → `defaultEnabled: true` → MFA exigido. Owner precisa explicitamente desligar para mudar.

## 🚫 Fora de escopo

- MFA por organização ou cliente (este sprint trata só admins da plataforma `/admin/*`).
- Per-admin opt-in/opt-out — toggle continua **estritamente global**.
- Outros tipos de fator (WebAuthn, SMS) — segue só TOTP.
- Reescrita de `FeatureFlagsList` — apenas extender `handleToggle` para essa flag específica.
- Telemetria de "quantas plataformas desligaram MFA admin" — não há coleta agregada.
- Mudança no `mfa_reset_required` (Sprint 11) — flag per-admin **continua** funcionando exatamente como hoje.
- Invalidação imediata de cache após toggle — TTL natural de 30s é o contrato.

## ⚠️ Critérios de Aceite

- [ ] Owner consegue desligar e religar MFA admin pela página `/admin/settings/feature-flags`.
- [ ] Toggle gera entrada no audit log com IP e User-Agent (via RPC existente).
- [ ] Admin não-owner não vê o controle ativável (Switch desabilitado **e** RPC bloqueia).
- [ ] Com flag **desligada**, admin sem fator MFA acessa `/admin/dashboard` direto após login.
- [ ] Com flag **ligada**, comportamento atual de `/admin/*` é preservado integralmente (redirect para `mfa-challenge` ou `mfa-enroll`).
- [ ] `profiles.mfa_reset_required = true` continua forçando re-enroll mesmo com flag desligada (regressão proibida).
- [ ] Modal de confirmação aparece **somente ao desligar** `require_admin_mfa`, não ao religar e não em outras flags.
- [ ] Cache da flag no middleware tem staleness aceitável de até 30s.
- [ ] Erro de leitura no middleware aplica fail-safe (MFA exigido) e loga sem quebrar o request.
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] **Guardian aprova o código** — gate único para compliance de design system.

---

## 🤖 Recomendação de Execução

**Análise:**
- Nível: STANDARD
- Complexity Score: **7** (Server Action reutilizada +0 / helper novo +2 / lógica nova de gate +3 / modal específico +1 / dependência interna +1)
- Reference Module: **não** (sem cópia mecânica — infra reusada mas há lógica nova)
- Integração com API externa: não
- Lógica de negócio nova/ambígua: **sim** — gate em middleware com cache de processo, ortogonalidade com `mfa_reset_required` (Sprint 11), fail-safe em erro de leitura, modal de confirmação assimétrico (só em desligamento). Pontos sensíveis de segurança que precisam de PRD para evitar drift.
- Ambiguity Risk: **alto** — middleware é caminho crítico de auth; erro = brecha de segurança ou DoS.

---

### Opção 1 — SIMPLES (sem PRD)
- **Fluxo:** Tech Lead → @db-admin → @backend → @frontend+ → @guardian → gates → commit
- **PRD:** pulado; o próprio sprint file é o contrato
- **Modelo sugerido:** Sonnet
- **Quando faz sentido:** se você confiar que o sprint file já cobre todos os cantos sensíveis (ortogonalidade com Sprint 11, fail-safe, modal assimétrico) sem cold review adicional. Risco: drift em pontos de segurança que não foram explicitamente testados.

### Opção 2 — COMPLETA (com PRD)
- **Fluxo:** Tech Lead → @spec-writer → @sanity-checker (loop até 3×) → STOP & WAIT → execução idêntica à Opção 1
- **PRD:** gerado em `prds/prd_admin_14_require_admin_mfa_toggle.md` e validado
- **Modelo sugerido:** Opus (cold review só paga o custo em Opus)
- **Quando faz sentido:** middleware de auth, fail-safe explícito, ortogonalidade com flag per-admin do Sprint 11. Custo extra de PRD ≪ custo de regressão de segurança.

---

**Recomendação do @sprint-creator:** **Opção 2 — Opus**

**Justificativa:**
Árvore de decisão dispara no item 3 (lógica de negócio nova/ambígua em ponto crítico de segurança). Score 7 está na zona intermediária, mas o ambiguity risk alto e a ausência de Reference Module mecânico empurram para Opção 2 pela regra anti-viés do `@sprint-creator`. Cold review do `@spec-writer` + `@sanity-checker` paga o custo ao garantir que o PRD trate explicitamente: (a) ortogonalidade com `mfa_reset_required`, (b) comportamento fail-safe em erro de leitura no middleware, (c) modal assimétrico (só em desligamento), (d) staleness máximo de 30s no cache de processo.

**Aguardando escolha do usuário:** responda ao Tech Lead com `"execute opção 1"` ou `"execute opção 2"` (ou aceite a recomendação dizendo apenas `"execute"`).

---

## 🔄 Execução

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| Validação de DB / RLS | `@db-admin` | ✅ Concluído | n/a — sem migration. Validado via MCP: RLS enabled, policy `authenticated_can_read_feature_flags` (qual=true) permite SELECT no middleware, RPC `admin_set_feature_flag` existente cobre mutation owner-only com audit IP/UA |
| Backend (registry + helper + middleware) | `@backend` | ✅ Concluído | `src/lib/featureFlags/registry.ts` (entrada `require_admin_mfa`), `src/lib/featureFlags/getRequireAdminMfa.ts` (novo, helper com cache TTL 30s + fail-safe), `src/middleware.ts` (gate antes do bloco aal2; bloco `mfa_reset_required` preservado fora do gate). GATE 2: build OK, lint sem novos warnings. |
| Integration tests | `@qa-integration` | ✅ Concluído | n/a — confirmado via `git diff --name-only HEAD`: nenhum arquivo em `src/lib/actions/**/actions.ts` foi tocado. GATE 4.5 não se aplica. |
| Frontend (modal de confirmação) | `@frontend+` | ✅ Concluído | `src/components/admin/settings/FeatureFlagsList.tsx` (modificado: state `confirmingDisable`, `applyToggle` factor-out, intercept de `require_admin_mfa` em on→off, Dialog de confirmação com `AlertTriangle` + Button danger). Decisão: usado `Dialog` existente em vez de `AlertDialog` (não há AlertDialog no projeto; Dialog cobre o caso). GATE 2: build OK, lint sem novos warnings. GATE 5 estático: 0 violações. |
| Guardian | `@guardian` | ✅ Concluído | GATE 4 APROVADO. Todas as checagens §1a/§1b/§2/§3a/§3b/§5 passam. Sem migration → §4 N/A. Falsos positivos no grep de segurança identificados (`password_reset` é nome de RPC em comentário; `organization_id` é leitura de JWT pré-existente). |

**Legenda:** ⬜ Pendente · ▶️ Em andamento · ✅ Concluído · ⏸️ Aguarda review
