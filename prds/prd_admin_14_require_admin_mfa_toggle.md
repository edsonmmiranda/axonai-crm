# PRD: Toggle global de obrigatoriedade de MFA para administradores

**Template:** PRD_STANDARD
**Complexity Score:** 7 points (DB 0 + API 0 + UI 1 + Business Logic 5 + Dependências 1)
**Sprint:** admin_14
**Created:** 2026-04-30
**Status:** Draft

---

## 1. Visão Geral

### Objetivo de Negócio

A obrigatoriedade de MFA (aal2) para acesso a `/admin/*` é hard-coded no middleware ([src/middleware.ts:180-187](../src/middleware.ts#L180-L187)) — não há forma de relaxá-la sem deploy. Este PRD especifica a exposição desse comportamento como **feature flag global** `require_admin_mfa`, controlável pelo `owner` da plataforma a partir da página existente [/admin/settings/feature-flags](../src/app/admin/settings/feature-flags/page.tsx).

A flag tem `defaultEnabled: true` (greenfield e ambientes recém-deployados ficam protegidos automaticamente). Toggle herda **mutação owner-only** + **audit log com IP/UA** já implementados pela RPC `admin_set_feature_flag`.

### User Story

Como **owner da plataforma**, eu quero ligar/desligar a obrigatoriedade de MFA para todos os admins sem deploy, para que eu possa escolher o trade-off entre fricção de onboarding e exigência de segundo fator conforme a fase do ambiente.

### Métricas de Sucesso

- Owner consegue desligar e religar MFA admin pela UI sem alterar código.
- 100% das mutações da flag geram entrada no audit log com `who/when/IP/UA`.
- Zero regressão no comportamento de `mfa_reset_required` (Sprint 11) — admins com a flag per-admin continuam sendo forçados a re-enroll independentemente do toggle global.
- Staleness máximo de **30s** em cada Edge instance após toggle (limite explícito do contrato; não é meta de melhoria).

---

## 2. Requisitos de Banco de Dados

### Novas Tabelas
**Nenhuma.** O sprint reutiliza integralmente a tabela `feature_flags` existente.

### Tabelas Modificadas
**Nenhuma.** Sem mudança de schema, índice ou constraint.

### Tabelas Existentes Usadas

- **`feature_flags`** — armazena o estado da flag `require_admin_mfa`. Schema verificado:
  - Colunas relevantes: `key TEXT PK`, `enabled BOOLEAN`, `config JSONB`, `updated_at`, `updated_by FK profiles`.
  - Linha não persistida ⇒ middleware aplica fallback `defaultEnabled: true` do registry. **Sem backfill.**

### Validação de RLS (não cria policies)

Validação feita via MCP em 2026-04-30:

```
Tabela feature_flags — RLS enabled
Policies SELECT existentes:
  1. platform_admins_can_read_feature_flags   (qual: EXISTS platform_admins WHERE profile_id = auth.uid() AND is_active=true)
  2. authenticated_can_read_feature_flags     (roles: authenticated, qual: true)
```

A policy #2 garante que **qualquer usuário autenticado** consegue executar `SELECT enabled FROM feature_flags WHERE key = 'require_admin_mfa'`. Como o middleware roda nesse contexto após o gate `if (!user) redirect to /admin/login`, a leitura está autorizada — **sem necessidade de criar RPC `SECURITY DEFINER` dedicada**.

> **Nota lateral (fora de escopo deste sprint):** a policy `authenticated_can_read_feature_flags` permite que qualquer authenticated leia **todas** as flags, incluindo `isPublic: false`. Não é vetor de segurança crítico (flags são booleanos de política, não credentials), mas merece um sprint próprio para revisar se a leitura de flags `isPublic: false` deveria ser restrita a `platform_admins`. **Não tratar aqui.**

### RPC já existente reutilizada

- **`admin_set_feature_flag(p_key, p_enabled, p_config, p_ip_address, p_user_agent)`** — mutation owner-only com audit log embutido. Sem alteração.

---

## 3. Contrato de API e Backend

### Server Actions

**Nenhuma nova Server Action.** A action existente [setFeatureFlagAction](../src/lib/actions/admin/feature-flags.ts) cobre integralmente o caso (validação Zod, `requirePlatformAdminRole(['owner'])`, RPC com IP/UA, `revalidatePath`). O sprint adiciona apenas a chave no registry — a action consome o registry dinamicamente via `getFeatureFlagsAction`.

### Helper de leitura para middleware (novo módulo)

**Arquivo:** `src/lib/featureFlags/getRequireAdminMfa.ts`

**Assinatura:**

```typescript
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FEATURE_FLAG_REGISTRY } from './registry';

const FLAG_KEY = 'require_admin_mfa';
const TTL_MS = 30_000;

let cached: { value: boolean; expiresAt: number } | null = null;

export async function getRequireAdminMfaCached(
  supabase: SupabaseClient,
): Promise<boolean>;
```

**Lógica:**

1. Se `cached !== null` e `cached.expiresAt > Date.now()` → retorna `cached.value`.
2. Senão, executa `SELECT enabled FROM feature_flags WHERE key = 'require_admin_mfa'` (via `supabase.from('feature_flags').select('enabled').eq('key', FLAG_KEY).maybeSingle()`).
3. Se erro: chama `console.error('[mw:require_admin_mfa]', err)` e retorna **`true`** (fail-safe). **Não atualiza o cache em caso de erro** — permite recovery rápido na próxima request.
4. Se sucesso e linha existe: usa `data.enabled`. Se linha não existe: usa `defaultEnabled` do registry (`true`).
5. Atualiza `cached = { value, expiresAt: Date.now() + TTL_MS }` e retorna.

**Restrições:**

- ⛔ **Crítico:** não exporta o cache nem função de invalidação. Sem `revalidateTag` ou similar — TTL natural de 30s é o único mecanismo de refresh.
- ⛔ **Crítico:** qualquer falha de leitura retorna `true` (fail-safe). Nunca propaga erro para o middleware.
- Não usa `react.cache` (é per-request, inadequado para middleware). Não usa `unstable_cache` (não tem hook idiomático para invalidação a partir do middleware).
- O helper é importado **somente** pelo middleware. Demais consumidores (RSC, actions) usam a action `getFeatureFlagsAction` existente.

### Integração no middleware

**Arquivo:** [src/middleware.ts](../src/middleware.ts)

**Localização da mudança:** dentro do bloco `if (isAdminRoute && !isAdminPublic)`, **após** a verificação `if (!user) redirect to /admin/login` (linha 173-178) e **antes** do bloco aal2 (linha 180).

**Diff conceitual:**

```typescript
if (isAdminRoute && !isAdminPublic) {
  if (!user) { /* … redirect /admin/login (preservado) … */ }

  // NOVO: gate de obrigatoriedade global
  const mfaRequired = await getRequireAdminMfaCached(supabase);

  if (mfaRequired) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== 'aal2') {
      const url = request.nextUrl.clone();
      url.pathname = aal?.nextLevel === 'aal2' ? '/admin/mfa-challenge' : '/admin/mfa-enroll';
      url.search = '';
      return NextResponse.redirect(url);
    }
  }

  // PRESERVADO INTEGRALMENTE: re-enroll forçado per-admin (Sprint 11)
  // Roda INDEPENDENTE de mfaRequired — regressão proibida.
  const { data: profile } = await supabase
    .from('profiles')
    .select('mfa_reset_required')
    .eq('id', user.id)
    .maybeSingle<{ mfa_reset_required: boolean }>();

  if (profile?.mfa_reset_required) {
    const url = request.nextUrl.clone();
    url.pathname = '/admin/mfa-enroll';
    url.search = '';
    url.searchParams.set('reenroll', 'true');
    return NextResponse.redirect(url);
  }
}
```

**Pontos críticos:**

- ⛔ **Crítico:** o bloco `mfa_reset_required` (Sprint 11) fica **fora** do `if (mfaRequired)`. Admins com `mfa_reset_required = true` continuam sendo forçados a re-enroll independente da flag global. Critério §6 do brief explicitamente proíbe a regressão.
- `ADMIN_PUBLIC_PATHS` não muda. Rotas `/admin/login`, `/admin/mfa-enroll`, `/admin/mfa-challenge`, `/admin/unauthorized`, `/admin/accept-invite` continuam isentas.
- Comportamento de `/dashboard/*` não é afetado.

### Registry de feature flags

**Arquivo:** [src/lib/featureFlags/registry.ts](../src/lib/featureFlags/registry.ts)

**Adicionar entrada** (terceira posição, após `enable_ai_summarization`):

```typescript
{
  key: 'require_admin_mfa',
  label: 'Exigir MFA para administradores',
  description: 'Quando ligado, todo admin deve completar MFA (aal2) para acessar /admin/*. Desligar reduz a barreira de segurança — admins sem fator entram com aal1.',
  isPublic: false,
  defaultEnabled: true,
}
```

---

## 4. Componentes de UI

### Árvore de componentes

```
Page: /admin/settings/feature-flags  (sem mudança)
└── AdminShell  (sem mudança)
    └── FeatureFlagsList  ← MODIFICADO
        ├── Switch (existente — uma instância por flag)
        └── AlertDialog (NOVO — instância única, controlada por estado)
            ├── AlertDialogContent
            ├── AlertDialogTitle
            ├── AlertDialogDescription
            ├── AlertDialogCancel
            └── AlertDialogAction
```

### FeatureFlagsList (modificação)

**Arquivo:** [src/components/admin/settings/FeatureFlagsList.tsx](../src/components/admin/settings/FeatureFlagsList.tsx)

**Props:** sem alteração na assinatura — `{ flags: FeatureFlagView[]; canMutate: boolean }`.

**Estado novo:**

```typescript
const [confirmingDisable, setConfirmingDisable] = useState<{
  key: string;
  label: string;
} | null>(null);
```

**Comportamento de `handleToggle` modificado:**

```typescript
function handleToggle(key: string, newEnabled: boolean) {
  if (!canMutate) return;

  // Interceptar apenas: require_admin_mfa indo de on → off
  if (key === 'require_admin_mfa' && newEnabled === false) {
    const flag = flags.find((f) => f.key === key);
    if (flag) setConfirmingDisable({ key, label: flag.label });
    return;
  }

  // Caminho default (todas as outras flags + religar require_admin_mfa)
  applyToggle(key, newEnabled);
}

function applyToggle(key: string, newEnabled: boolean) {
  setOptimistic((prev) => ({ ...prev, [key]: newEnabled }));
  startTransition(async () => {
    const result = await setFeatureFlagAction({ key, enabled: newEnabled });
    if (!result.success) {
      setOptimistic((prev) => ({ ...prev, [key]: !newEnabled }));
      toast.error(result.error ?? 'Erro ao salvar flag.');
    } else {
      toast.success(`Flag "${key}" ${newEnabled ? 'ativada' : 'desativada'}.`);
    }
  });
}
```

**Modal de confirmação (renderizado no fim do JSX da lista):**

```jsx
<AlertDialog
  open={!!confirmingDisable}
  onOpenChange={(open) => { if (!open) setConfirmingDisable(null); }}
>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Desligar MFA obrigatório para administradores?</AlertDialogTitle>
      <AlertDialogDescription asChild>
        <div className="flex flex-col gap-2 text-sm">
          <p>Ao desligar esta política:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Admins sem fator TOTP configurado passarão a entrar com <strong>aal1</strong> (sem segundo fator).</li>
            <li>Admins com <code>mfa_reset_required = true</code> <strong>continuam</strong> sendo forçados a re-enroll (regra do Sprint 11 — não é afetada).</li>
            <li>Esta ação fica registrada no audit log com <strong>IP</strong> e <strong>User-Agent</strong>.</li>
          </ul>
        </div>
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel onClick={() => setConfirmingDisable(null)}>
        Cancelar
      </AlertDialogCancel>
      <AlertDialogAction
        onClick={() => {
          if (confirmingDisable) {
            applyToggle(confirmingDisable.key, false);
            setConfirmingDisable(null);
          }
        }}
        className="bg-feedback-danger-bg text-feedback-danger-fg hover:bg-feedback-danger-bg/90"
      >
        Sim, desligar MFA admin
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

**Componentes do design system usados:**

- `Switch` from `src/components/ui/switch` (existente — sem mudança).
- `AlertDialog`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogCancel`, `AlertDialogAction` from `src/components/ui/alert-dialog` (componente shadcn padrão, já existente no projeto — `@frontend+` confirma via `Glob` antes de codificar).
- `Badge` from `src/components/ui/badge` (existente — sem mudança).

**Tokens semânticos usados (modal):**

- Background do `AlertDialogContent`: padrão do componente (`bg-surface-raised` ou equivalente — vem do shadcn local, sem override).
- Text title/description: `text-text-primary` / `text-text-secondary` (padrão do `AlertDialog`).
- Botão de confirmação destrutiva: `bg-feedback-danger-bg` + `text-feedback-danger-fg` para destacar o impacto. Hover: `bg-feedback-danger-bg/90`.
- Cancelar: usa o variant default do `AlertDialogCancel` (sem override).
- Ícone de aviso (opcional): `text-feedback-warning-fg` se `@frontend+` decidir adicionar um ícone `AlertTriangle` no header.

**Estado:**

- `optimistic` (existente): controla visualmente o Switch enquanto a mutation roda.
- `confirmingDisable`: controla a abertura do modal e armazena qual flag está em confirmação.
- `pending` (existente, vem de `useTransition`): desabilita Switches durante mutation.

**Comportamento:**

- On Switch toggle de `require_admin_mfa` indo on → off: abre o modal, **não** chama `setFeatureFlagAction` ainda.
- On modal Cancel ou close: `setConfirmingDisable(null)`. **Não** faz nada com o estado da flag — o `optimistic` nem chega a ser atualizado, porque `applyToggle` não foi chamado. Switch permanece visualmente ligado.
- On modal Confirm: chama `applyToggle(key, false)`, fecha modal. Switch agora reflete o estado otimista (off) e a mutation roda.
- On Switch toggle de qualquer outra flag (qualquer direção) ou de `require_admin_mfa` indo off → on: caminho atual sem modal.
- `canMutate = false`: Switch permanece desabilitado, modal nunca abre. Comportamento existente preservado.

> 🎨 Não redeclarar regras do design system aqui. O `@frontend+` segue [`design_system/components/CONTRACT.md`](../design_system/components/CONTRACT.md) e o Guardian valida.

---

## 5. Edge Cases

### Estados de autenticação e permissão

- [ ] **Não-owner com a página aberta:** Switch desabilitado (`canMutate=false`). Mesmo que o usuário consiga chamar `setFeatureFlagAction` manualmente (devtools), a RPC `admin_set_feature_flag` retorna `unauthorized` e a action devolve mensagem amigável.
- [ ] **Owner sem fator MFA + flag `require_admin_mfa = false` recém-aplicada:** owner consegue acessar `/admin/dashboard` direto após login. Pode optar por step-up manual depois (rota `/admin/mfa-enroll` continua acessível).
- [ ] **Admin com `mfa_reset_required = true` + flag `require_admin_mfa = false`:** o bloco de re-enroll roda **incondicionalmente**. Admin é redirecionado para `/admin/mfa-enroll?reenroll=true`. Critério §6 do brief.
- [ ] **Admin com fator MFA configurado + flag `require_admin_mfa = false`:** o bloco aal2 é **pulado**. Admin entra com `aal1` mesmo tendo fator. Pode optar por step-up manual; rotas `/admin/mfa-challenge` e `/admin/mfa-enroll` continuam acessíveis.

### Estados de dados

- [ ] **Linha de `feature_flags` ausente para `require_admin_mfa`:** middleware lê `null` → fallback `defaultEnabled = true` do registry → MFA exigido (default seguro). Sem necessidade de backfill em DB.
- [ ] **Toggle concorrente (dois owners simultâneos):** RPC do Supabase resolve serialmente. Último write vence. Audit log registra ambas as mutações com IP/UA distintos.

### Estados de erro

- [ ] **Erro ao ler flag no middleware** (timeout, RLS rejeita, conexão cai): helper retorna `true` (fail-safe) e loga `console.error`. Request prossegue normalmente para o gate aal2 — admin vê o comportamento mais seguro até a conexão se restabelecer. **Cache não é atualizado em erro** — próxima request tenta de novo.
- [ ] **Modal aberto e usuário fecha o navegador:** sem efeito colateral. Estado otimista do Switch não foi atualizado (modal intercepta antes), e nenhuma mutation foi disparada. Próximo carregamento mostra o estado real da flag.

### Estados de UI

- [ ] **Modal aberto + usuário clica fora (overlay):** mesmo comportamento de Cancel — `setConfirmingDisable(null)`, sem mutation.
- [ ] **Religar a flag (off → on):** **sem modal**. Switch direto para o caminho `applyToggle`. Comportamento simétrico ao toggle de outras flags.

### Cache e propagação

- [ ] **Staleness após toggle (até 30s):** owner desliga a flag às 12:00:00 → Edge instance A pode continuar exigindo MFA até 12:00:30 (TTL local). Comportamento aceitável e documentado.
- [ ] **Múltiplas Edge instances:** cada instance mantém seu próprio cache. Sem coordenação. Owner pode forçar re-leitura aguardando 30s ou redeployando.

---

## 6. Critérios de Aceite

### Banco de dados
- [ ] Sem nova migration — migrations atuais não são tocadas.
- [ ] `@db-admin` confirma via MCP que a policy `authenticated_can_read_feature_flags` permite a leitura no contexto do middleware.

### Backend
- [ ] `FEATURE_FLAG_REGISTRY` contém a entrada `require_admin_mfa` com `isPublic: false`, `defaultEnabled: true`.
- [ ] Helper `getRequireAdminMfaCached` existe em `src/lib/featureFlags/getRequireAdminMfa.ts` com diretiva `'server-only'`, TTL 30s, fail-safe `true` em qualquer erro, sem export do cache.
- [ ] Middleware integra o helper antes do bloco aal2; bloco `mfa_reset_required` permanece fora do gate da flag.
- [ ] Nenhuma Server Action nova foi criada — `setFeatureFlagAction` existente é usada via UI.
- [ ] Erros retornam mensagens amigáveis (já garantido pela action existente).

### Frontend
- [ ] **Design system:** o código passa em todas as checagens do [`agents/quality/guardian.md`](../agents/quality/guardian.md) § 1a e § 1b.
- [ ] Modal `AlertDialog` aparece **somente** ao desligar `require_admin_mfa`, **nunca** ao religar e **nunca** em outras flags.
- [ ] Cancel e click-fora-do-modal fazem rollback completo — Switch permanece visualmente ligado.
- [ ] Confirm fecha modal e dispara `applyToggle(key, false)`.
- [ ] Switch desabilitado quando `canMutate=false` — modal não abre.
- [ ] Componente verificado com `data-theme="dark"` togglado no `<html>`.

### Integração end-to-end
- [ ] **Cenário 1:** owner liga a flag → admin sem fator é redirecionado para `/admin/mfa-enroll`. (Comportamento atual preservado.)
- [ ] **Cenário 2:** owner desliga a flag (passa pelo modal) → admin sem fator acessa `/admin/dashboard` direto.
- [ ] **Cenário 3:** flag desligada + admin com `mfa_reset_required=true` → admin é redirecionado para `/admin/mfa-enroll?reenroll=true`. Regressão **proibida**.
- [ ] **Cenário 4:** RPC de mutação registra audit log com IP e User-Agent legíveis.
- [ ] **Cenário 5:** `npm run build` passa sem erros; `npm run lint` passa sem novos warnings.

---

## 7. Rollback

**Se problemas forem encontrados após deploy:**

1. **Rollback de código (preferencial):**
   ```bash
   git revert <commit-hash>
   git push
   ```
   Reverte a integração no middleware e o helper. A entrada no registry pode ficar (não tem efeito sem o helper). A action `setFeatureFlagAction` não foi alterada.

2. **Rollback de dados (se necessário desligar a flag mantendo o código):**
   ```sql
   -- Religar manualmente via SQL (caso UI esteja indisponível)
   SELECT admin_set_feature_flag(
     'require_admin_mfa', true, '{}'::jsonb, NULL, 'rollback-script'
   );
   ```
   Audit log registra a operação com user-agent `'rollback-script'`.

3. **Limpar cache:** sem ação manual. TTL de 30s força refresh natural em todas as Edge instances. Se necessário forçar imediato, redeploy do middleware.

**Tempo estimado de rollback:** 2 minutos (`git revert` + push + deploy automático).

**Ponto crítico:** o rollback de código **não** desabilita o forçamento de re-enroll do Sprint 11 (`mfa_reset_required`) — esse mecanismo é independente e deve continuar operacional.
