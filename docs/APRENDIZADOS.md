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
