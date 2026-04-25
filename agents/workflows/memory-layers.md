---
name: memory-layers
description: Fonte única sobre a camada de memória persistente do framework — onde escrever o quê
---

# Camada de Memória do Framework

O framework tem **uma camada de memória persistente**. Escrever a coisa errada aqui polui o contexto dos agentes e causa drift. Esta é a **fonte única** — qualquer outro arquivo que descreva camadas de memória é pointer para aqui.

**Leitores:** Tech Lead carrega `APRENDIZADOS.md` integralmente no boot (PASSO 2) e repassa entradas relevantes como contexto ao delegar para sub-agentes. Sub-agentes recebem apenas o recorte que interessa à tarefa.
**Writers:** os writers específicos de cada camada abaixo.

"O que foi construído" **não tem arquivo dedicado** — é derivável do código (`src/app/`, `src/components/`, `src/lib/integrations/`) e do git log. Estado do banco vem diretamente do banco via MCP (`mcp__supabase__list_tables`, `mcp__supabase__execute_sql`), nunca de `supabase/migrations/` (histórico write-only) nem de arquivo de snapshot (removido — era cache que ficava desatualizado). Manter esse inventário em doc só gera drift.

---

## A camada de memória persistente

| Arquivo | Propósito | Quem escreve | Quem lê | Ciclo de vida |
|---|---|---|---|---|
| [`docs/APRENDIZADOS.md`](../../docs/APRENDIZADOS.md) | **Armadilhas inesperadas e padrões descobertos** que não são óbvios pelo código: erros de build que travaram sprints, quirks de framework, tipos que não funcionam como esperado. | Qualquer agente que descubra algo não-trivial durante a execução | Todos os agentes na fase de planejamento (para evitar repetir o mesmo erro) | Append-only — **só registrar se for surpreendente**. Sprints rotineiras NÃO geram aprendizados |

> **Schema do banco não é memória persistente.** Ele vive no banco real e é consultado via MCP quando necessário (`mcp__supabase__list_tables`, `mcp__supabase__execute_sql`). Não existe mais `docs/schema_snapshot.json` — era cache que ficava desatualizado silenciosamente.

---

## Regras de higiene

### ❌ NÃO escrever em `APRENDIZADOS.md`:
- "Sprint X completa com sucesso" — isso é git history, não aprendizado
- Descrição do que a feature faz — isso é o PRD ou o sprint file
- Fixes triviais que qualquer dev encontraria sozinho
- Resumos de atividade ou "o que foi feito" — isso vai no commit message

### ✅ SIM escrever em `APRENDIZADOS.md`:
- "Next.js 15 app router falha o build quando `searchParams` é usado em layout sem Suspense wrapper" — é surpreendente e vai economizar horas na próxima vez
- "RLS policy com `auth.uid()` dentro de função marcada como `SECURITY DEFINER` vaza dados entre users — sempre usar `SECURITY INVOKER`" — armadilha de segurança não-óbvia
- "Zod 4 mudou `.errors` para `.issues` — código antigo usando `error.errors[0]` quebra silenciosamente" — pattern descoberto durante migração

---

## Fluxo de decisão rápido ao terminar uma sprint

```
Aconteceu algo inesperado ou contra-intuitivo durante a sprint?
├─ SIM → registrar em `docs/APRENDIZADOS.md` no formato enxuto (título + Regra em 1 linha, ≤3 linhas total; história longa fica no git blame/commit)
└─ NÃO → não escrever nada em Aprendizados. Seguir para o commit.
```

---

## Além dessa camada

Outros artefatos armazenam informação mas **não são memória persistente do framework**:

- `sprints/active/sprint_XX_*.md` (e `sprints/done/` após conclusão) — intenção/escopo de uma sprint específica (input, não memória acumulada)
- `prds/*.md` — especificação técnica de uma sprint (gerado a partir do sprint file, efêmero após execução)
- `docs/api_research/*_research.md` — relatórios Fase 1 do `@api-integrator` (input para Fase 2)
- Git history — autoridade sobre "quem mudou o quê e quando"

Se você está tentando decidir onde registrar algo e a camada acima não parece óbvia, provavelmente não é memória de framework — é um artefato de trabalho. Deixe no commit message ou no sprint file.
