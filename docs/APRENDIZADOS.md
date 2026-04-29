# 📖 Aprendizados

Log append-only de **armadilhas não-óbvias e padrões descobertos durante sprints**. Este arquivo existe para impedir que o mesmo erro custe tempo duas vezes.

> **Writers:** qualquer agente. **Só registre se foi genuinamente surpreendente** — sprints rotineiras NÃO geram aprendizados. Categorias: `BUILD`, `TIPO`, `SUPABASE`, `NEXT`, `ZOD`, `SHADCN`, `PERF`, `SECURITY`, `DEPLOY`, `AGENT-DRIFT`. Entradas novas vão **no topo** da seção "Entradas" (ordem cronológica reversa). Pedagogia completa (quando/como registrar, formato detalhado, exemplos de calibragem, formato AGENT-DRIFT) está no bloco `<!-- ... -->` abaixo — abra o arquivo no editor para consultar.

<!--
---

## 🎯 Propósito

- **Writers:** qualquer agente (`@backend`, `@frontend`, `@db-admin`, `@api-integrator`, etc.) que descobriu algo surpreendente durante a execução de uma sprint.
- **Readers:** todos os agentes na fase de análise/planejamento, para evitar repetir o mesmo erro.
- **Writer autoritativo em caso de dúvida:** Tech Lead, ao final de cada sprint (Workflow A, Step 7).

## 📏 Regra de ouro

> **Só registre se foi genuinamente surpreendente.** Sprints rotineiras NÃO devem gerar aprendizados. Se tudo correu como esperado, não escreva nada aqui.

### ✅ Registre quando
- Um erro de build ou de tipagem travou a sprint e a causa não era óbvia pelo código.
- Uma biblioteca tem quirk ou breaking change não documentado que fez você perder horas.
- Você descobriu um padrão novo ou uma armadilha de segurança/performance que qualquer agente futuro deveria saber antes de mexer na mesma área.
- Um comportamento do Supabase, Next.js, Zod, ShadcnUI ou similar contradisse o que a documentação sugeria.
- **[AGENT-DRIFT] O orquestrador (Tech Lead ou usuário) teve que pedir 2+ correções ao mesmo agente sobre a mesma categoria de problema na mesma sprint** (ex: `@frontend` usou hex hard-coded 3 vezes, `@backend` esqueceu `revalidatePath` em múltiplas actions). Registre o padrão que o agente está repetindo — isso revela lacuna no prompt/contract, não só um bug pontual.

### ❌ NÃO registre
- "Sprint X completa com sucesso" — isso é git history, não aprendizado.
- Descrição do que a feature faz — isso é o PRD ou o sprint file.
- Fixes triviais que qualquer dev encontraria sozinho.
- Resumos de atividade ou "o que foi feito" — isso vai no commit message.

### 🎯 Exemplos (calibragem)

| Situação | Registrar? | Por quê |
|---|---|---|
| Zod 4 usa `.issues` em vez de `.errors` | ✅ SIM | Breaking change não óbvio da biblioteca |
| `npm install some-dep` rodou normal | ❌ NÃO | Trivial |
| Instalei react-hook-form, tudo certo | ❌ NÃO | Sem surpresa |
| `@frontend` usou `bg-blue-500` duas vezes em sprints diferentes, mesmo o CONTRACT proibindo | ✅ SIM | [AGENT-DRIFT] — prompt do `@frontend` precisa de reforço |
| Supabase RLS bloqueou query onde eu esperava que passasse, causou debug de 40min | ✅ SIM | Comportamento contradiz expectativa |
| Renomeei variável `cwd` para `currentWorkingDir` | ❌ NÃO | Refactor trivial, git diff já documenta |
| Tive que pedir "use tokens semânticos, não hex" 3x pro mesmo agente na mesma sprint | ✅ SIM | [AGENT-DRIFT] canônico |

---

## 📝 Formato de entrada

**Princípio:** o arquivo é lido por todos os agentes a cada sprint. Cada palavra aqui vira custo de contexto permanente. Escreva a **regra**, não a história. Contexto/causa raiz/story estão no `git blame` da própria entrada → commit message → PR. Não duplique.

Novas entradas entram **no topo** (ordem cronológica reversa), usando este formato enxuto:

```markdown
### YYYY-MM-DD · [CATEGORIA] Título curto (≤70 chars)

**Regra:** Uma linha acionável que um agente futuro pode seguir sem ler mais nada. Se precisar de 2+ linhas, provavelmente você está narrando — reescreva.
**Follow-up:** (opcional, 1 linha) ação pendente registrada em outro lugar.
```

**Limite duro:** entrada ≤ 3 linhas (título + Regra + Follow-up opcional). Se sentir vontade de escrever Contexto/Problema/Causa raiz/Solução em prosa, pare — isso não é aprendizado, é narração. Corta.

**Exemplo bom:**

```markdown
### 2026-04-15 · [SUPABASE] `get_table_policies` não expõe `polwithcheck`
**Regra:** não auditar RLS pelo probe — policies INSERT/UPDATE saem incompletas. Escrever via `DROP POLICY IF EXISTS` + `CREATE POLICY` idempotentes.
**Follow-up:** criar `get_table_policies_full` (sprint futura).
```

**Exemplo ruim (NÃO fazer):** repetir Contexto, Problema, Causa raiz, Solução, Regra geral em blocos separados. Isso infla o arquivo e duplica o que já está no código/commit.

**Categorias aceitas:** `BUILD`, `TIPO`, `SUPABASE`, `NEXT`, `ZOD`, `SHADCN`, `PERF`, `SECURITY`, `DEPLOY`, `AGENT-DRIFT`.

### Formato específico para `AGENT-DRIFT`

```markdown
### YYYY-MM-DD — [AGENT-DRIFT] @agent repetiu <tipo de erro>

**Agente afetado:** `@frontend` / `@backend` / `@db-admin` / etc.

**Sprint:** sprint_XX_<nome>

**Padrão repetido:** <uma frase — o que o agente continuou fazendo errado>

**Frequência nesta sprint:** <N> correções pedidas sobre o mesmo problema

**Gatilho provável:** <prompt/contract lacuna — ex: CONTRACT.md não lista essa proibição explicitamente>

**Correção estrutural recomendada:** <mudança a fazer no agents/stack/*.md, design_system/, ou standards.md para que próximos sprints não repitam>
```

> **Regra adicional do Tech Lead (encerramento de sprint):** antes de invocar `@git-master`, conte quantas vezes você re-delegou para o mesmo agente pelo mesmo tipo de problema. Se ≥2, **é obrigatório** registrar `[AGENT-DRIFT]`.
-->

---

## 📚 Entradas

### 2026-04-29 · [SUPABASE] INSERT em tabela multi-tenant precisa de `organization_id` explícito

**Regra:** tabelas com `organization_id NOT NULL` (sem default/trigger) exigem que toda Server Action passe `organization_id: ctx.organizationId` no `.insert()` — RLS WITH CHECK não preenche, e o erro vira toast genérico após cleanup do Storage. Auditar todos os `.insert()` em `src/lib/actions/*.ts` antes de mergear módulo novo.

### 2026-04-28 · [SUPABASE] RPC `SECURITY DEFINER` que usa `auth.uid()` deadlock com service-role client

**Regra:** se a RPC autoriza internamente via `auth.uid()` (ex.: `WHERE profile_id = auth.uid()`), ela só funciona chamada com user-JWT client (`createClient()`), nunca com `createServiceClient()` — service role não tem JWT, `auth.uid()` retorna NULL, check falha → `RAISE 'unauthorized'`. Conceda `GRANT EXECUTE ... TO authenticated` (defense em profundidade vem do check interno + `requirePlatformAdmin*` no app). Erro `PostgrestError` aparece como `{}` no console por props non-enumerable — não confundir com "RPC não existe".

### 2026-04-28 · [TIPO] Supabase MFA `data.totp` exclui factors `unverified` por type narrowing

**Regra:** `supabase.auth.mfa.listFactors()` tipa `data.totp[i].status` como `'verified'` apenas — quem precisa varrer factors `unverified` (ex.: limpar enroll incompleto antes de re-enrollar) deve usar `data.all` com filtro `f.factor_type === 'totp' && f.status === 'unverified'`. Filtrar `data.totp` por `status === 'unverified'` quebra build com TS2367 ("comparison appears to be unintentional").

### 2026-04-26 · [SUPABASE] `error instanceof Error` é falso para `PostgrestError` retornado por `supabase.rpc()`

**Regra:** o helper `rpcErrorMessage(error: unknown)` que faz `error instanceof Error ? error.message : String(error)` retorna `'[object Object]'` para erros de RPC — `PostgrestError` é um plain object com `.message`/`.details`/`.code`/`.hint`, não uma instance de `Error`. Mapping de codes (`'org_not_found'`, `'plan_limit_exceeded'`, etc.) deve extrair `.message` via narrowing tipado:
```ts
if (error !== null && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
  msg = error.message;
}
```
Este mesmo bug existe em `src/lib/actions/admin/plans.ts` (Sprint 06) — só não foi exercitado por testes lá. Auditar `src/lib/actions/admin/*.ts` ao tocar.

### 2026-04-25 · [NEXT] Route groups não adicionam prefixo de URL — conflito de paths

**Regra:** `src/app/(admin)/login/` resolve para `/login`, conflitando com `src/app/(auth)/login/`. Para prefixar rotas admin em `/admin/*`, usar pasta real `src/app/admin/` — não route group `(admin)`.

### 2026-04-25 · [NEXT] `process.env[variável]` não funciona em Client Components

**Regra:** Next.js só substitui `NEXT_PUBLIC_*` com acesso literal (`process.env.NEXT_PUBLIC_X`). Acesso dinâmico via `process.env[name]` funciona server-side mas retorna `undefined` no bundle do browser. `src/lib/supabase/client.ts` precisou de refactor para usar acesso literal.

### 2026-04-25 · [NEXT] Redirecionamentos cruzados entre páginas MFA criam loop

**Regra:** Páginas de MFA (enroll ↔ challenge) com redirecionamentos automáticos bidirecionais criam loop quando há estado inconsistente (ex: fator unverified). O roteamento correto pertence ao login form (via `getAuthenticatorAssuranceLevel`), não às páginas de MFA. Páginas de MFA devem exibir erro + link manual, nunca redirecionar automaticamente entre si.

### 2026-04-24 · [TIPO] Grep por `role === 'member'` não captura `Record<SessionRole, string>` com chave literal

**Regra:** Em refactors de SessionRole, grepar só por comparações (`=== 'member'`) deixa escapar `Record<Role, string>` com chave literal e Zod `z.enum(['admin', 'member'])`. O TypeScript break-on-build é o catch-all real — não depender só do grep, depender do build como segunda passagem.

### 2026-04-24 · [SUPABASE] `REVOKE FROM public` não cobre role `anon` em funções novas

**Regra:** Supabase aplica `DEFAULT PRIVILEGES` que concedem `EXECUTE` a `anon`/`authenticated`/`service_role` em toda função criada em `public`. `REVOKE ALL FROM public` revoga só do pseudo-role PUBLIC — para fechar `anon` explicitamente é obrigatório `REVOKE EXECUTE ... FROM anon;`. Verificar com `has_function_privilege('anon','fn(sig)','execute')`.

### 2026-04-24 · [SUPABASE] MCP read-only bloqueia `apply_migration` — fallback manual

**Regra:** quando `mcp__supabase__apply_migration` retornar "Cannot apply migration in read-only mode", não tentar escalar permissão — pedir ao usuário para colar o SQL no Studio e validar com múltiplos `execute_sql` (RLS, policies, grants, seeds, INV-1). Idempotência verifica-se estruturalmente (IF NOT EXISTS / ON CONFLICT / WHERE NOT EXISTS) já que não dá para re-aplicar empiricamente.

### 2026-04-22 · [SUPABASE] Auditoria de RLS pode marcar policy dead-code como violação

**Regra:** antes de "corrigir" uma policy flagada pelo `@db-auditor`, faça grep em `src/` pelo INSERT/UPDATE da tabela. Se a única call-site usa `createServiceClient()` ou roda em trigger `SECURITY DEFINER`, a policy é dead code — drope em vez de reescrever, e adicione policy `WITH CHECK (false)` para preservar coverage 4-cmd.
**Follow-up:** considerar Check 9 no `@db-auditor` que cruze policies com call-sites em `src/lib/actions/**` antes de classificar como violação.

### 2026-04-21 — [AGENT-DRIFT] @frontend+ repetiu botões inline em vez de `<Button>` (2ª ocorrência)

**Agente afetado:** `@frontend+`

**Sprint:** sprint_15_whatsapp_groups

**Padrão repetido:** usou `<button className="...bg-action-danger...">` em 3 locais (danger zone, 2× dialog confirm) e `<Link>/<button>` com classes de primary/secondary inline no header de página — mesmo drift do sprint_10.

**Frequência nesta sprint:** 5 instâncias em 3 arquivos

**Gatilho provável:** `@frontend+` copia fielmente o reference module, e o reference module (`leads-origins`) já tinha o padrão inline; a regra em `agents/stack/frontend-plus.md` mencionada no sprint_10 ainda não foi atualizada.

**Correção estrutural recomendada:** atualizar `agents/stack/frontend-plus.md` com regra explícita; atualizar o reference module `leads-origins` para usar `<Button variant="danger">` e `<Button asChild variant="secondary">` — enquanto o módulo de referência tiver o padrão errado, @frontend+ vai continuar copiando.

### 2026-04-21 · [NEXT] Server Action serializa `undefined` de objeto como `null`

**Regra:** Nunca passar `{ id: s.id }` quando `s.id` pode ser `undefined` para Server Actions — Next.js converte `undefined` em `null` na serialização, quebrando constraints NOT NULL. Usar spread condicional: `...(s.id ? { id: s.id } : {})`.

### 2026-04-21 · [SHADCN] `SelectItem` proíbe `value=""`

**Regra:** Radix `<Select.Item value="">` lança runtime error — string vazia é reservada para limpar a seleção. Usar sentinel explícito (ex.: `"neutral"`) e converter para `null` no `onValueChange`.

### 2026-04-20 — [AGENT-DRIFT] @frontend+ repetiu botões inline em vez de `<Button>`

**Agente afetado:** `@frontend+`

**Sprint:** sprint_10_leads_lista

**Padrão repetido:** criou `<button className="...bg-action-danger...">` inline em 4 locais (MarkAsLostDialog, DeleteLeadDialog, LeadForm danger zone, new/page.tsx) em vez de usar `<Button variant="danger">` que já existe no DS.

**Frequência nesta sprint:** 4 instâncias (agrupadas em 2 categorias: danger buttons, action buttons)

**Gatilho provável:** o prompt do `@frontend+` não enfatiza que variantes existentes do Button (danger, secondary) devem ser reutilizadas; o agente copia styling do design system diretamente em vez de compor com o componente.

**Correção estrutural recomendada:** adicionar regra explícita no `agents/stack/frontend-plus.md`: "Antes de escrever classes de botão inline, verifique se `src/components/ui/button.tsx` já tem a variante necessária. Usar `<Button variant=X>` é obrigatório quando a variante existe."

### 2026-04-16 · [SHADCN] Tokens aninhados Tailwind exigem prefixo do namespace

**Regra:** com `colors.border = { DEFAULT, subtle, strong, focus }`, escreva `border-border`, `border-border-subtle`, `divide-border-subtle` — NUNCA `border-subtle`/`border-default`/`divide-subtle` (não geram CSS, fallback silencioso para `currentColor` ≈ borda preta). Mesma regra para qualquer namespace aninhado (`field-border`, `feedback-success-border`, etc.).
**Follow-up:** considerar grep guard no CI (`\b(border|divide)-(subtle|default|strong)\b` deve dar zero).

### 2026-04-15 · [SHADCN] `verify-design` barra CSS vars do Radix em classes

**Regra:** `min-w-[var(--radix-select-trigger-width)]` (padrão shadcn p/ match trigger↔content) dispara `arbitrary-dimension`. Omita a classe — conteúdo dimensiona pelo próprio conteúdo — ou mova o width-matching para fora do className.
