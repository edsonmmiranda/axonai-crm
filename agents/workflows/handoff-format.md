# Handoff Format

Protocolo de comunicação entre Tech Lead (orquestrador) e sub-agentes em **agent mode** (Claude Agent SDK). Este formato é canônico — todo agente com `mode: [persona, agent]` no frontmatter segue ele.

## Sentinela de modo

- **Persona mode (default):** sub-agente é uma persona adotada pelo Tech Lead na mesma sessão. Comunicação por texto livre. Não usa este formato.
- **Agent mode (SDK):** sub-agente roda em sessão isolada, com contexto próprio. Comunicação exclusivamente via os arquivos descritos abaixo.

A escolha entre os dois modos é feita pelo Tech Lead no `Passo 5 — modo de dispatch` do preflight (ver [`agents/00_TECH_LEAD.md`](../00_TECH_LEAD.md)).

## Convenção de pasta

```
sprints/handoffs/<sprint-id>/
├── <agent>_input.md
├── <agent>_result.md
└── ...
```

- `<sprint-id>`: nome do sprint file sem extensão (ex.: `sprint_03_customers`).
- Pasta criada pelo Tech Lead no primeiro dispatch SDK do sprint.
- Excluída de versionamento (`.gitignore` lista `sprints/handoffs/`).
- Limpa automaticamente quando o sprint move de `sprints/active/` para `sprints/done/`.

## Convenção de nome

| Caso | Padrão |
|---|---|
| Input padrão | `<agent>_input.md` |
| Result padrão | `<agent>_result.md` |
| Iteração em loops (ex.: `@spec-writer` ↔ `@sanity-checker`) | `<agent>_input_v2.md`, `<agent>_input_v3.md` |
| Result de iteração | `<agent>_result_v2.md`, etc. |

`<agent>` é o `name` do frontmatter sem o `@` (ex.: `guardian`, não `@guardian`).

## Formato — input file

```markdown
# Handoff → @<agent> | <sprint-id>
**Mode:** agent
**Issued by:** @tech-lead
**Issued at:** <ISO timestamp>
**Iteration:** <N>   (presente apenas em loops)

## Sources of truth
- Sprint: sprints/active/<sprint-id>.md
- PRD: prds/<prd>.md (status: <draft|approved>)   (quando aplicável)
- Reference module: <path>   (quando aplicável)

## Scope of this handoff
<descrição concisa do que ESTE agente deve produzir nesta invocação>

## Files to review/process
<lista explícita de paths que o agente deve ler ou processar — ex.: saída de `git diff --name-only HEAD`>

## APRENDIZADOS pré-filtrados
<entradas literais de docs/APRENDIZADOS.md filtradas pelas tags declaradas em `aprendizadosTags` do frontmatter do agente, cada uma marcada com `[APRENDIZADO PRÉ-FILTRADO]` no header>

## Upstream results
- @<previous-agent>: <status> — <key artifacts>
<presente apenas se o agente depende de output de agente anterior; lista os paths declarados em "Files created" do result file upstream>

## Constraints / overrides
<quaisquer desvios do default — nomes específicos de tabela, edge cases especiais, modelo de referência cherry-picked>
```

## Formato — result file

```markdown
# Result: @<agent> | <sprint-id>
**Status:** success | blocked | escalation | pendingHumanApproval
**Completed at:** <ISO timestamp>
**Gate (<owned-gate>):** ✅ <pass description> | ❌ <fail description> | n/a

## Files created
- <path>
[ou "- (none)"]

## Files modified
- <path>
[ou "- (none)"]

## Gate output
<saída do gate truncada em 20 linhas — só se gate falhou; ver "Truncamento de logs" abaixo>

## Verdict / Summary
<resumo curto do trabalho ou veredicto, conforme natureza do agente — agentes verdict-based como @guardian colocam o template completo aqui>

## Notes
<só se algo não-óbvio aconteceu>

## Handoff downstream
- Next agent: @<next-agent> | (none)
- Context: <estrutura mínima que o próximo precisa saber>
```

## Status values

| Status | Significado | Próxima ação do Tech Lead |
|---|---|---|
| `success` | Trabalho concluído, gate próprio passou | Avançar para o próximo agente do workflow |
| `blocked` | Tentou mas falhou — precisa retry com mais contexto | Retry (máx 2), depois escalação |
| `escalation` | Bloqueio fundamental que invalida o PRD | Seguir [`escalation-protocol.md`](escalation-protocol.md) |
| `pendingHumanApproval` | Concluiu fase mas espera aprovação humana (ex.: `@api-integrator` Phase 1) | Pausar, apresentar ao usuário, re-despachar após aprovação |

## Truncamento de logs

`Gate output` deve ser truncado a 20 linhas, seguindo as mesmas regras do GATE 2 / GATE 4.5 em `00_TECH_LEAD.md`:

```bash
# Build (npm run build)
... 2>&1 | grep -E "(Error|error TS|src/)" | head -20

# Tests (vitest)
... 2>&1 | grep -E "(FAIL|✗|AssertionError|Expected|Received|at .*\.test\.ts)" | head -20
```

## Responsabilidades

| Quem | Cria | Lê |
|---|---|---|
| Tech Lead | `<agent>_input.md` | `<agent>_result.md` |
| Sub-agente | `<agent>_result.md` | `<agent>_input.md` |

Sub-agente em SDK mode **não** lê histórico de conversa, **não** lê outros result files (a menos que explicitamente listados em "Upstream results" do seu input), e **não** decide próxima ação — apenas reporta no result file. Decisão de fluxo é exclusiva do Tech Lead.

## Sentinela de detecção (sub-agente)

Sub-agente identifica que está em SDK mode pela presença do arquivo declarado em `handoffInput` do seu frontmatter. Se existe → SDK mode → ler input como primeira ação. Se não existe → persona mode → seguir fluxo padrão.

## Resolução de placeholders no frontmatter

Os campos `handoffInput` e `handoffOutput` no frontmatter usam `${sprint}` como placeholder. O Tech Lead substitui pelo `<sprint-id>` real ao gerar o input file e ao instruir o sub-agente. Em persona mode, esses campos são ignorados.
