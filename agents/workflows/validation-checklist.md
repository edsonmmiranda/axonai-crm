---
description: Referência completa de validação para Sanity Checker e Sprint Creator — detecção de nível de sprint, checklists por template, 4 modos de output, categorias de edge case, compliance de reference module
---

# Validation Checklist (Referência completa)

## 🎯 Propósito

Este documento é a **referência completa** usada pelo `@sanity-checker` (e opcionalmente pelo `@sprint-creator`) ao validar sprint files e PRDs. O arquivo do agente em si (`agents/product/sanity-checker.md`) contém o fluxo de decisão e os entry points — este arquivo contém os checklists detalhados dos quais o fluxo depende.

**Ordem de carregamento ao validar:**
1. Ler `agents/product/sanity-checker.md` para a árvore de decisão e o fluxo de 6 passos.
2. Ler este arquivo para os checklists detalhados referenciados por cada passo.

---

## 🧭 Step 0 — Pré-condições

Na v2.0 do framework, o sanity-checker só é invocado em **Opção 2** (usuário escolheu execução com PRD). Opção 2 **sempre** implica sprint STANDARD — LIGHT é forçada para Opção 1 (sem PRD) e nunca chega ao sanity-checker.

### Como validar

Abra o sprint file de origem `sprints/active/sprint_XX_*.md` e busque no header por:

```markdown
> **Nível:** STANDARD
```

### Tabela de pré-condições

| Condição                                      | Ação                                                                                |
|-----------------------------------------------|-------------------------------------------------------------------------------------|
| Sprint `**Nível:** STANDARD` + PRD_STANDARD   | ✅ prosseguir com validação (Step 1+)                                               |
| Sprint `**Nível:** STANDARD` + PRD_COMPLETE   | ✅ prosseguir com validação (Step 1+)                                               |
| Sprint `**Nível:** LIGHT` (qualquer PRD)      | ❌ REJECTED — Tech Lead não deveria ter invocado sanity-checker                     |
| Sem marcador de nível                         | Assumir STANDARD, seguir                                                             |
| PRD com header diferente de STANDARD/COMPLETE | ❌ REJECTED — regerar com template válido                                           |

### Resposta para sprint LIGHT com PRD (erro de roteamento)
```
SANITY CHECK: REJEITADO — Erro de roteamento

O sprint é LIGHT. Sprints LIGHT rodam Opção 1 (sem PRD) por design.
O sanity-checker não deveria ter sido invocado.

AÇÃO: Tech Lead deve abortar o fluxo, descartar o PRD, e retomar execução na Opção 1
(delegação direta para @frontend+/@backend).
```

### Resposta para template de PRD inválido
```
SANITY CHECK: REJEITADO — template de PRD inválido

Os únicos templates suportados são PRD_STANDARD (score 0-8) e PRD_COMPLETE (score 9+).

OBRIGATÓRIO: @spec-writer deve regerar o PRD usando `prd_standard.md` ou `prd_complete.md`
conforme o complexity score documentado.
```

---

## 📋 Step 1 — Checklists de completude por template

### PRD_STANDARD (7 seções)
- [ ] **Visão geral** — Objetivo de negócio, User Story, Métricas de sucesso
- [ ] **Requisitos de banco de dados** — linguagem natural estruturada (tabelas, campos, tipos, constraints, RLS)
- [ ] **Contrato de API** — com schemas Zod para toda Server Action e **regras de negócio testáveis** (uma bullet por regra — consumidas pelo `@qa-integration` para gerar `it(...)` dedicado)
- [ ] **Componentes de UI** — referenciando o contrato do design system em [`design_system/components/CONTRACT.md`](../../design_system/components/CONTRACT.md) (tokens semânticos, primitivos Radix, variantes `cva`)
- [ ] **Edge cases** — mínimo de **5** casos em pelo menos 3 categorias
- [ ] **Critérios de aceite** — todos binários (passa/falha)
- [ ] **Rollback** — passos + estimativa de tempo

### PRD_COMPLETE (11 seções)
- [ ] **Visão geral** — Objetivo de negócio, User Story, Métricas de sucesso
- [ ] **Requisitos de banco de dados** — schema completo com políticas RLS
- [ ] **Contrato de API** — schemas Zod + respostas de erro + **regras de negócio testáveis** (uma bullet por regra — consumidas pelo `@qa-integration` para gerar `it(...)` dedicado)
- [ ] **Integração com API externa** — se aplicável (endpoints, auth, webhooks)
- [ ] **Componentes de UI** — referenciando [`design_system/components/CONTRACT.md`](../../design_system/components/CONTRACT.md) + mapeamento de estados (default / hover / active / focus-visible / disabled / loading / error)
- [ ] **Edge cases** — mínimo de **10** casos cobrindo todas as 7 categorias abaixo
- [ ] **Critérios de aceite** — todos binários, agrupados por fase
- [ ] **Implementation Plan** — com estimativas de tempo por fase
- [ ] **Riscos e mitigações**
- [ ] **Dependências**
- [ ] **Plano de rollback**

---

## 📋 Sprint Validation Checklist (usado pelo Sprint Creator antes de salvar)

### Objetivo
- [ ] **Objetivo claro** — Frase única descrevendo o que será construído
- [ ] **Valor de negócio** — Por que essa feature importa
- [ ] **Critérios de sucesso** — Como medir sucesso

### Escopo
- [ ] **Features específicas** — Não vago ("adicionar CRUD" sozinho é vago demais)
- [ ] **Ações do usuário** — O que o usuário pode fazer
- [ ] **Comportamento do sistema** — Como o sistema responde
- [ ] **Fora de escopo** — Listado explicitamente para prevenir scope creep

### Schema de banco de dados (apenas sprints STANDARD)
- [ ] **Nome da tabela** — Claramente definido
- [ ] **Todos os campos** — Nome, tipo, constraints
- [ ] **Relacionamentos** — Foreign keys especificadas
- [ ] **Políticas RLS** — Controle de acesso descrito
- [ ] **Índices** — Considerações de performance

### Contrato de API (se integração externa)
- [ ] **URLs de endpoint** — Caminhos completos
- [ ] **Métodos HTTP**
- [ ] **Formatos de request/response**
- [ ] **Método de autenticação**

### UI/UX
- [ ] **Estrutura de página** — Layout descrito
- [ ] **Componentes** — Lista de peças de UI
- [ ] **Fluxo do usuário** — Passo a passo
- [ ] **Referência Gold Standard** — Qual módulo existente seguir

### Edge Cases (STANDARD mínimo 5)
Veja **Categorias de Edge Case** abaixo. Para LIGHT, edge cases são opcionais (sprint LIGHT não passa por sanity-checker na v2.0).

### Critérios de aceite
- [ ] **Binários** — Passa/falha, sem ambiguidade
- [ ] **Testáveis**
- [ ] **Cobrem todas as features**

---

## 🧪 Categorias de Edge Case (usadas pelo Step 3)

Um PRD com cobertura de alta qualidade de edge cases toca na maioria dessas categorias. **PRD_COMPLETE deve cobrir todas as 7**; **PRD_STANDARD deve cobrir pelo menos 3**.

1. **Estados vazios** — sem dados, sem resultados de busca, primeira execução
2. **Erros de validação** — input inválido, campos obrigatórios, erros de formato, limites de tamanho
3. **Erros de rede** — timeout, offline, erro 5xx de servidor, conexão lenta
4. **Erros de autenticação** — não logado, sessão expirada, não autorizado, tenant errado
5. **Operações concorrentes** — dois tabs editando o mesmo registro, delete enquanto edita, race conditions
6. **Limites de dados** — máximo de entradas, tamanho de arquivo, limites de paginação, rate limits
7. **Browser / ambiente** — browser não suportado, JS desabilitado, mobile vs desktop

Cada edge case deve documentar: **gatilho → comportamento esperado → caminho de recuperação**.

---

## 🤖 Binary Approval Script (fonte de verdade para decisão)

**Regra:** o modo de output (`APPROVED` / `REJECTED` / ...) é decidido por um checklist **programático** — não por julgamento subjetivo. Se os checks abaixo passam, **você é obrigado a retornar `APPROVED`**, mesmo que o PRD "pudesse ser melhor". Polimento cosmético **nunca** é motivo de rejeição.

Execute em ordem. Primeiro fail para a decisão.

```yaml
# Pseudocódigo declarativo — execute cada check contra o PRD markdown do spec-writer.
# Para cada regra, extraia a seção/campo correspondente e aplique o predicado.

checks:
  # STEP 0 — pré-condições (v2.0)
  - id: S0_sprint_is_standard
    rule: "sprint.level == 'STANDARD' (or no marker, which assumes STANDARD)"
    fail: REJECTED  # sprint LIGHT não deveria estar aqui — erro de roteamento

  - id: S0_template_is_valid
    rule: "prd.template in ['PRD_STANDARD', 'PRD_COMPLETE']"
    fail: REJECTED  # template inválido — spec-writer regera com o template correto

  # STEP 1 — required fields present (template-specific)
  - id: S1_all_required_fields_present
    rule: "every field marked `required: true` in the template has a non-empty value"
    fail: REJECTED

  # STEP 2 — ambiguity (binary heuristic)
  - id: S2_no_banned_phrases
    rule: |
      no field value matches any of:
        - /funcion(a|ar) bem/i
        - /ficar? bonit/i
        - /boa performance/i
        - /limpo/i (isolated, not "código limpo" + spec)
        - /adequad/i (without concrete metric)
        - /intuitiv/i
    fail: REJECTED

  # STEP 3 — edge case counts
  - id: S3_edge_case_count
    rule: |
      STANDARD: len(prd.edge_cases) >= 5 and distinct(ec.category) >= 3
      COMPLETE: len(prd.edge_cases) >= 10 and distinct(ec.category) == 7
    fail: REJECTED

  # STEP 4 — binary acceptance criteria
  - id: S4_criteria_are_binary
    rule: |
      every ac in prd.acceptance_criteria has:
        - ac.check: a grep/command/boolean that returns pass|fail (no prose)
        - ac.criterion does NOT match banned_phrases
    fail: REJECTED

  # STEP 5 — implementation plan (COMPLETE only)
  - id: S5_impl_plan_present
    when: "prd.template == 'PRD_COMPLETE'"
    rule: |
      prd.implementation_plan.phases has items AND
      every phase has estimated_minutes: int AND
      total_estimated_minutes == sum(phase.estimated_minutes)
    fail: REJECTED

  # STEP 6 — reference module compliance (conditional)
  - id: S6_reference_module_compliance
    when: "sprint.reference_module is defined OR prd.reference_module_compliance exists"
    rule: "all fields in prd.reference_module_compliance are non-empty"
    fail: REJECTED

decision:
  if all checks pass: APPROVED
  elif only S3 failed by 1-2 cases OR S5 missing time estimates: CONDITIONAL_APPROVAL
  elif ambiguity requires PO decision (multiple valid interpretations): REJECTED_WITH_CONDITIONS
  else: REJECTED
```

> **Proteção contra perfeccionismo loop:** Uma vez que o Binary Approval Script retorna `APPROVED`, você **não pode** rejeitar o PRD por motivos estéticos/de polimento. Se você quer sugerir melhoria não-bloqueante, use `CONDITIONAL_APPROVAL` com "A) prosseguir como está" como primeira opção. **Nunca** prenda o usuário em um loop onde cada iteração adiciona nitpicks novos.

> **Proteção contra agreement loop:** O spec-writer e o sanity-checker são a mesma LLM. Para evitar aprovação prematura, o sanity-checker **DEVE executar o Binary Approval Script literalmente** (não por "feeling"). Se um check falha em grep/regex concreto, é fail — não há interpretação.

---

## 🎯 Step 4 — Binariedade dos critérios de aceite

### ❌ Não-binário (REJEITAR)
- "A UI deve ficar boa"
- "A performance deve ser aceitável"
- "O código deve estar limpo"
- "Carrega rápido"

### ✅ Binário (ACEITAR)
- "Todos os componentes interativos são construídos sobre um primitivo Radix ou compostos a partir de `src/components/ui/`" → sim/não
- "Página carrega em menos de 2 segundos" → sim/não (mensurável)
- "Zero literais hex/`rgb(`/`hsl(`/`oklch(` sob `src/`" → grep retorna 0 matches → sim/não
- "Zero classes primitivas de cor sob `src/` (`bg-blue-500`, `text-neutral-900`, etc.)" → grep retorna 0 matches → sim/não
- "Zero valores arbitrários de Tailwind sob `src/` (`p-[17px]`, `w-[350px]`, etc.)" → grep retorna 0 matches → sim/não
- "Componente renderiza corretamente com `data-theme=\"dark\"` togglado no `<html>`" → sim/não
- "`npm run build` sai com código 0" → sim/não
- "`npm test -- --run tests/integration/<module>.test.ts` sai com código 0 e nenhum teste pulado (GATE 4.5)" → sim/não (se o sprint envolve Server Actions)
- "Comandos `npm run check` e `npm run contrast` em `design_system/build/` saem com código 0" → sim/não (se o PR tocou `design_system/tokens/`)

**Regra prática:** se você não consegue escrever um script ou checkbox que responda o critério com um sim ou não definitivo, ele não é binário.

---

## 🧬 Step 6 — Checklist de Reference Module Compliance

**Disparado quando** o sprint file contém uma seção "🧬 Reference Module Compliance" OU o PRD contém uma seção "Reference Module Compliance".

### Campos obrigatórios
- [ ] **Caminho do módulo de referência** especificado (ex.: `src/app/dashboard/[module]/` + `src/lib/actions/[module].ts`)
- [ ] **Arquivos a copiar** — lista completa (páginas, layouts, componentes, actions, schemas)
- [ ] **Substituições de nome de entidade** — antigo → novo (ex.: `[EntityA]` → `[EntityB]`, `[entity_a]_id` → `[entity_b]_id`)
- [ ] **Substituições de nome de arquivo** — antigo → novo
- [ ] **Substituições de nome de componente** — antigo → novo
- [ ] **Substituições de nome de função** — antigo → novo (nomes de action, helpers)
- [ ] **Padrões a preservar** — tratamento de erro, estilo de validação, abordagem de RLS
- [ ] **Exemplos concretos** — pelo menos um before/after completo de um arquivo renomeado

### Resposta de rejeição
```
SANITY CHECK: REJEITADO

[REFERENCE MODULE] Seção de compliance faltando:

Sprint/PRD menciona módulo de referência: `src/app/[module]/`
Mas o PRD NÃO tem uma seção "Reference Module Compliance" (ou está incompleta).

OBRIGATÓRIO: Spec Writer deve adicionar uma seção documentando:
1. Todos os arquivos a copiar do módulo de referência
2. Padrões exatos de substituição de naming
3. Padrões a preservar

@spec-writer: Por favor adicione a seção Reference Module Compliance ao PRD.
```

---

## 📝 Os quatro modos de output (tabela de referência)

| Modo                        | Quando                                                                  | Efeito                                                   |
|-----------------------------|-------------------------------------------------------------------------|----------------------------------------------------------|
| ✅ APROVADO                 | Todas as checagens passam                                               | Prosseguir para execução                                 |
| ⚠️ APROVAÇÃO CONDICIONAL    | 1–2 questões menores (1 edge case faltando, estimativa de tempo)        | Oferecer quick-fix ou opções de aceitar-como-está        |
| ⚠️ REJEITADO COM CONDIÇÕES  | Ambiguidade exige decisão do Product Owner (escolha A/B/C)              | Pedir ao PO para escolher, depois Spec Writer atualiza   |
| ❌ REJEITADO                | Seções faltando, critérios não-binários, <5 edge cases, problema fundamental | Loop de volta ao `@spec-writer` com feedback       |

Templates completos de output vivem em `agents/product/sanity-checker.md` — esta tabela é o mapa de referência rápida.

---

## 🚨 Critérios de rejeição (resumo)

Rejeite um sprint ou PRD se **qualquer** um dos abaixo for verdadeiro:

1. **Requisitos vagos** — "Adicionar CRUD", "Melhorar UI", "Funcionar bem"
2. **Schema de banco de dados faltando** — Sem estrutura de tabela (STANDARD/COMPLETE)
3. **Edge cases insuficientes** — <5 para STANDARD, <10 para COMPLETE
4. **Sem critérios de aceite** ou menos de 5 (STANDARD/COMPLETE)
5. **Critérios não-binários** — não passa/falha
6. **Contrato de API faltando** quando API externa está envolvida
7. **Sem schemas Zod** em seções de Server Action (STANDARD/COMPLETE)
8. **Reference Module Compliance faltando** quando um módulo de referência é declarado
9. **Plano de rollback faltando**
10. **PRD invocado para sprint LIGHT** (erro de roteamento — sprints LIGHT rodam Opção 1 sem PRD) ou **template de PRD inválido** (apenas PRD_STANDARD e PRD_COMPLETE são suportados)

---

## ✅ Critérios de aprovação (resumo)

Aprove quando **todos** forem verdadeiros:

- ✅ Sprint é STANDARD (ou sem marcador) e PRD é PRD_STANDARD ou PRD_COMPLETE
- ✅ Todas as seções obrigatórias presentes para o template escolhido
- ✅ Sem linguagem vaga ou ambígua
- ✅ Edge cases suficientes para o template
- ✅ Todos os critérios de aceite são binários
- ✅ Schema de banco de dados completo (se aplicável)
- ✅ Contrato de API especificado com schemas Zod (se aplicável)
- ✅ Reference Module Compliance documentada (se aplicável)
- ✅ Plano de rollback existe

---

## 📚 Exemplos

### ❌ Sprint RUIM (vago, será rejeitado)

```markdown
## Objetivo
Adicionar CRUD para produtos

## Funcionalidades
- Criar produtos
- Editar produtos
- Deletar produtos

## Database
Tabela de produtos com campos
```

**Problemas:** objetivo vago, sem detalhe de schema, sem edge cases, sem critérios de aceite, sem marcador de nível de sprint.

### ✅ Sprint BOM (específico, será aprovado)

```markdown
# Sprint 03: Products CRUD (STANDARD)

> **Nível:** STANDARD

## Objetivo
Implementar CRUD completo de gerenciamento de produtos com rastreamento de inventário.

## Funcionalidades
1. Criar produto com nome, preço, SKU, descrição, quantidade em estoque
2. Listar produtos com paginação (20 por página), busca por nome/SKU
3. Editar detalhes do produto e atualizar quantidade em estoque
4. Soft delete de produtos (marcar como inativo, preservar dados)
5. Ver histórico do produto (criação, edições, mudanças de estoque)

## Schema de banco de dados
Tabela: products
- id: UUID (PK)
- user_id: UUID (FK → auth.users)
- name: TEXT (NOT NULL)
- sku: TEXT (UNIQUE, NOT NULL)
- price: NUMERIC(10,2) (NOT NULL, CHECK > 0)
- stock_quantity: INTEGER (DEFAULT 0, CHECK >= 0)
- is_active: BOOLEAN (DEFAULT true)
- created_at / updated_at: TIMESTAMPTZ

RLS: user_id = auth.uid()

## Edge Cases
1. Criar produto com SKU duplicado → Mostrar "SKU já existe"
2. Atualizar estoque para negativo → Erro de validação
3. Deletar produto com pedidos ativos → Apenas soft delete
4. Busca sem resultados → Empty state "Nenhum produto encontrado"
5. Carregando lista de produtos → Skeleton loaders por <500ms, depois dados

## Critérios de aceite
1. Usuário pode criar produto com todos os campos → Produto aparece na lista (sim/não)
2. Usuário pode buscar por SKU → Apenas produtos casando são mostrados (sim/não)
3. Usuário não pode criar SKU duplicado → Mensagem de erro exibida (sim/não)
4. `npm run build` sai com código 0 (sim/não)
5. Guardian aprova o código (sim/não)
```

---

## 🔗 Relacionados

- **Agentes que usam este workflow:** `@sanity-checker`, `@sprint-creator`, `@spec-writer`
- **Skills relacionadas:** `agents/skills/reference-module-copy/SKILL.md`
- **Workflows relacionados:** `agents/workflows/escalation-protocol.md`
