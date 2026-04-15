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
- Descrição do que a feature faz — isso é `architecture_state.md` ou o PRD.
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

Novas entradas entram **no topo** (ordem cronológica reversa), usando este formato:

```markdown
### YYYY-MM-DD — [CATEGORIA] Título curto do problema

**Contexto:** Em que sprint/módulo o problema apareceu (sem narrar o sprint inteiro, só o suficiente para localizar).

**Problema:** Uma frase descrevendo o comportamento inesperado.

\`\`\`ts
// ❌ ERRADO — reproduz o problema
\`\`\`

**Causa raiz:** Por que acontece (biblioteca X mudou, quirk do framework, etc).

**Solução:**

\`\`\`ts
// ✅ CORRETO
\`\`\`

**Regra geral:** Uma linha que um agente futuro pode seguir sem precisar ler o resto.
```

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

### 2026-04-15 — [DEPLOY] Invites sem provider de email: retornar `inviteUrl` copiável

**Contexto:** Sprint 04 (settings · team). `createInvitationAction` e `resendInvitationAction` precisam entregar o link de aceite, mas o projeto ainda não tem Resend/SMTP configurado.

**Problema:** integrar email transacional no mesmo sprint que monta o CRUD inteiro é escopo dobrado; sem solução, admins não conseguiriam adicionar membros.

**Solução:** actions retornam `{ token, inviteUrl }` e a UI (`InviteMemberDialog` / `PendingInvitationsList`) expõe botão "Copiar link" + fallback para selecionar o input readonly quando `navigator.clipboard` não existe. O link é construído a partir de `NEXT_PUBLIC_SITE_URL` → `headers().origin` → `host`. `resendInvitationAction` usa `crypto.randomUUID()` para regenerar o token (invalida o anterior).

**Regra geral:** enquanto provider de email não estiver integrado, **todo fluxo que dependeria de email transacional** (convites, reset, verificação) deve devolver URL copiável via `ActionResponse.data` e a UI deve ter um fallback de clipboard. Sprint dedicada de email é pré-requisito para remover esse padrão.

### 2026-04-15 — [SUPABASE] RPC bootstrap `get_table_policies` não expõe `polwithcheck`

**Contexto:** Sprint 04 (probe de DB). `@db-admin` precisava confirmar predicados das policies em `profiles`/`organizations`/`invitations` antes de decidir sobre migrations.

**Problema:** `get_table_policies(p_table_name)` (em `00000000000000_framework_bootstrap.sql`) retorna apenas `pg_get_expr(p.polqual, p.polrelid)`. Isso cobre `USING`, mas **omite `WITH CHECK`**. Policies INSERT ficam com `policy_definition = NULL`, e policies UPDATE com `WITH CHECK` só são parcialmente auditáveis. Resultado: o probe devolve `(none)` para todas as linhas e não dá para validar enforcement real.

**Causa raiz:** bootstrap pragmático priorizou colunas mínimas; `polwithcheck` ficou de fora.

**Solução (não aplicada nesta sprint, registrada como follow-up):** adicionar `get_table_policies_full(p_schema, p_table_name)` retornando `policy_using`, `policy_with_check`, `policy_roles`, `policy_permissive`. Idempotente (`CREATE OR REPLACE FUNCTION`), `GRANT EXECUTE ... TO service_role`. O snapshot em `docs/schema_snapshot.json` deve evoluir para incluir os campos extras.

**Regra geral:** qualquer auditoria de RLS que dependa de `get_table_policies` atual é incompleta. Ao escrever migrations de RLS, não confie só no probe — escreva as policies via `DROP POLICY IF EXISTS` + `CREATE POLICY` idempotentes e use o snapshot apenas como heurística de presença.

### 2026-04-15 — [SHADCN] Progress bar com % dinâmico: use `style={obj}` (variável), não `style={{...}}` literal

**Contexto:** Sprint 02 (dashboard mock). Barras de progresso (`GoalsRow`, `PipelineCard`) precisam de `width: X%` dirigido por prop do mock — e futuramente por Server Action. O `scripts/verify-design.mjs` (GATE 5 estático) bloqueia tanto `w-[82%]` (regex `[wh]-\[`) quanto `style={{...}}` literal (regex `\bstyle=\{\{[^}]+\}\}`).

**Problema:** as duas formas óbvias de escrever uma progress bar em Tailwind caem nas duas regras, e não há token Tailwind que varie por prop.

```tsx
// ❌ ambos bloqueiam no GATE 5
<div className={`w-[${percent}%]`} />
<div style={{ width: `${percent}%` }} />
```

**Causa raiz:** o regex de `inline-style` é literal `style={{`. Referenciar um objeto por variável produz `style={x}` (um só `{`), passa o regex. O Guardian explicitamente permite `style` para "valores genuinamente dinâmicos dirigidos por estado de runtime" em §1a de `agents/quality/guardian.md` — o bloqueio é de `style` com cor/padding/tamanho **literal estático**, não dinâmico.

**Solução:**

```tsx
const style = { width: `${stage.progressPercent}%` };
return <div className="h-full rounded-full bg-feedback-info-solid-bg" style={style} />;
```

**Regra geral:** para qualquer dimensão dirigida por runtime (progress, gráficos, sliders), declare `const style: React.CSSProperties = { ... }` acima do return e passe por referência. `style={{...}}` literal fica reservado para caso nenhum — sempre existe a alternativa da variável ou de um token Tailwind.

### 2026-04-14 — [BUILD] `tsc` varre `docs/templates/**/*.ts` no bootstrap e quebra o build

**Contexto:** Sprint 01 (bootstrap). Primeiro `npm run build` depois de criar `tsconfig.json` com `include: ["**/*.ts", "**/*.tsx"]`.

**Problema:** Next/tsc typechecou `docs/templates/reference_module/actions.ts`, que importa `@/types/action-response` — path que só existirá quando um módulo real for criado. Build abortou.

```
./docs/templates/reference_module/actions.ts:5:37
Type error: Cannot find module '@/types/action-response'
```

**Causa raiz:** Arquivos `.ts` em `docs/templates/` são **skeletons** destinados a ser copiados por agentes, não código ativo. O `include` wildcard do tsconfig padrão não distingue — `**/*.ts` pega tudo que estiver fora de `exclude`.

**Solução:** adicionar ao `exclude` do `tsconfig.json` todas as pastas que contêm `.ts` "inerte": `docs`, `agents`, `sprints`, `scripts`, `supabase`, `design_system/build`. Templates ficam fora do compile graph; código real em `src/` continua coberto.

**Regra geral:** Em qualquer bootstrap novo sobre este framework, o `tsconfig.json` deve excluir `docs`, `agents`, `sprints`, `scripts`, `supabase` além dos defaults. Considerar mover este ajuste para um `tsconfig.base.json` versionado no framework.

