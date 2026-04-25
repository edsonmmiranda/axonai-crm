# 📖 Aprendizados — Pedagogia e Formato

> **Arquivo framework-owned.** Sobrescrito a cada `bash scripts/update-framework.sh`. Os dados reais (entradas do projeto) vivem em [`APRENDIZADOS.md`](./APRENDIZADOS.md), que é protegido do sync.

---

## 🎯 Propósito

- **Writers:** qualquer agente (`@backend`, `@frontend+`, `@db-admin`, `@api-integrator`, etc.) que descobriu algo surpreendente durante a execução de uma sprint.
- **Readers:** todos os agentes na fase de análise/planejamento, para evitar repetir o mesmo erro.
- **Writer autoritativo em caso de dúvida:** Tech Lead, ao final de cada sprint (Opção 2, Step 7).

## 📏 Regra de ouro

> **Só registre se foi genuinamente surpreendente.** Sprints rotineiras NÃO devem gerar aprendizados. Se tudo correu como esperado, não escreva nada.

### ✅ Registre quando
- Um erro de build ou de tipagem travou a sprint e a causa não era óbvia pelo código.
- Uma biblioteca tem quirk ou breaking change não documentado que fez você perder horas.
- Você descobriu um padrão novo ou uma armadilha de segurança/performance que qualquer agente futuro deveria saber antes de mexer na mesma área.
- Um comportamento do Supabase, Next.js, Zod, ShadcnUI ou similar contradisse o que a documentação sugeria.
- **[AGENT-DRIFT] O orquestrador (Tech Lead ou usuário) teve que pedir 2+ correções ao mesmo agente sobre a mesma categoria de problema na mesma sprint** (ex: `@frontend+` usou hex hard-coded 3 vezes, `@backend` esqueceu `revalidatePath` em múltiplas actions). Registre o padrão que o agente está repetindo — isso revela lacuna no prompt/contract, não só um bug pontual.

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
| `@frontend+` usou `bg-blue-500` duas vezes em sprints diferentes, mesmo o CONTRACT proibindo | ✅ SIM | [AGENT-DRIFT] — prompt do `@frontend+` precisa de reforço |
| Supabase RLS bloqueou query onde eu esperava que passasse, causou debug de 40min | ✅ SIM | Comportamento contradiz expectativa |
| Renomeei variável `cwd` para `currentWorkingDir` | ❌ NÃO | Refactor trivial, git diff já documenta |
| Tive que pedir "use tokens semânticos, não hex" 3x pro mesmo agente na mesma sprint | ✅ SIM | [AGENT-DRIFT] canônico |

---

## 📝 Formato de entrada

**Princípio:** o arquivo é lido por todos os agentes a cada sprint. Cada palavra aqui vira custo de contexto permanente. Escreva a **regra**, não a história. Contexto/causa raiz/story estão no `git blame` da própria entrada → commit message → PR. Não duplique.

Novas entradas entram **no topo** da seção `## 📚 Entradas` em `APRENDIZADOS.md` (ordem cronológica reversa), usando este formato enxuto:

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
### YYYY-MM-DD · [AGENT-DRIFT] @agent repetiu <tipo de erro>
**Agente/Sprint:** `@frontend+` em sprint_XX_<nome>
**Padrão:** <uma frase — o que o agente continuou fazendo errado> (N ocorrências)
**Correção estrutural:** <mudança em agents/stack/*.md, design_system/, ou standards.md>
```

> **Regra adicional do Tech Lead (encerramento de sprint):** antes de commitar, conte quantas vezes você re-delegou para o mesmo agente pelo mesmo tipo de problema. Se ≥2, **é obrigatório** registrar `[AGENT-DRIFT]`.
