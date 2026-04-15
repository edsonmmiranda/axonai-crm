---
name: memory-layers
description: Fonte única sobre as 3 camadas de memória persistente do framework — onde escrever o quê
---

# Camadas de Memória do Framework

O framework tem **três camadas de memória persistente**, cada uma com propósito distinto. Escrever a coisa errada na camada errada polui o contexto dos agentes e causa drift. Esta é a **fonte única** — qualquer outro arquivo que descreva camadas de memória é pointer para aqui.

**Leitores:** todos os agentes na fase de análise/planejamento.
**Writers:** Tech Lead (autoridade final ao fechar sprint), mais os writers específicos de cada camada abaixo.

---

## Tabela das três camadas

| Arquivo | Propósito | Quem escreve | Quem lê | Ciclo de vida |
|---|---|---|---|---|
| [`docs/schema_snapshot.json`](../../docs/schema_snapshot.json) | Estado **real** do schema do banco (tabelas, colunas, RLS, índices) introspectado via RPC do Supabase. Fonte única da verdade para "o que existe no banco agora". | `@db-admin` após cada migração | `@db-admin`, `@backend`, `@spec-writer` | Sobrescrito a cada introspecção — snapshot vivo, sem histórico |
| [`docs/architecture_state.md`](../../docs/architecture_state.md) | Mapa de **o que foi construído** no projeto: módulos, rotas, Server Actions, componentes, integrações externas. Referência de alto nível para o Tech Lead planejar novas sprints. | **Apenas o Tech Lead** ao final de cada sprint (Workflow A, Step 7 / Workflow B, Step 4). Nenhum outro agente escreve neste arquivo — se um agente precisa registrar algo (ex: nova integração), reporta ao Tech Lead que atualiza. | Tech Lead, `@spec-writer`, todos os agentes durante análise inicial | Append-only por sprint — cresce com o projeto |
| [`docs/APRENDIZADOS.md`](../../docs/APRENDIZADOS.md) | **Armadilhas inesperadas e padrões descobertos** que não são óbvios pelo código: erros de build que travaram sprints, quirks de framework, tipos que não funcionam como esperado. | Qualquer agente que descubra algo não-trivial durante a execução | Todos os agentes na fase de planejamento (para evitar repetir o mesmo erro) | Append-only — **só registrar se for surpreendente**. Sprints rotineiras NÃO geram aprendizados |

---

## Regras de higiene

### ❌ NÃO escrever em `architecture_state.md`:
- Detalhes de implementação que já vivem no código (ex.: "função usa `.eq('user_id', user.id)`")
- Decisões de UI específicas de um componente
- Qualquer coisa que o `schema_snapshot.json` já descreva (colunas, tipos, RLS)
- Versões de dependências (vivem em `package.json`)
- Layout do repositório (é derivável de `ls`)

### ❌ NÃO escrever em `APRENDIZADOS.md`:
- "Sprint X completa com sucesso" — isso é git history, não aprendizado
- Descrição do que a feature faz — isso é `architecture_state.md` ou o PRD
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
├─ SIM → registrar em `docs/APRENDIZADOS.md` com: problema, causa raiz, solução, regra geral
└─ NÃO → não escrever nada em Aprendizados. Seguir para o commit.

Criou nova tabela, rota, Server Action, componente visível, ou integração?
├─ SIM → append em `docs/architecture_state.md`
└─ NÃO → não escrever nada lá.

Mudou o schema do banco?
├─ SIM → `@db-admin` re-roda introspecção → sobrescreve `docs/schema_snapshot.json`
└─ NÃO → não tocar no schema_snapshot.
```

---

## Além dessas três camadas

Outros artefatos armazenam informação mas **não são memória persistente do framework**:

- `sprints/active/sprint_XX_*.md` (e `sprints/done/` após conclusão) — intenção/escopo de uma sprint específica (input, não memória acumulada)
- `docs/prds/*.md` — especificação técnica de uma sprint (gerado a partir do sprint file, efêmero após execução)
- `docs/api_research/*_research.md` — relatórios Fase 1 do `@api-integrator` (input para Fase 2)
- Git history — autoridade sobre "quem mudou o quê e quando"

Se você está tentando decidir onde registrar algo e nenhuma das três camadas acima parece óbvia, provavelmente não é memória de framework — é um artefato de trabalho. Deixe no commit message ou no sprint file.
