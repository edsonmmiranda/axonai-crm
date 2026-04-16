# Sprint XX: [Feature Name] (STANDARD)

> **Nível:** STANDARD
> **Quando usar:** novo módulo CRUD, nova tabela com RLS, nova integração externa, mudanças que afetam múltiplos módulos, features com regras de negócio ou edge cases relevantes.
> **Quando NÃO usar:** se é um bugfix ou ajuste de UI em um único arquivo → use `docs/templates/sprints/TEMPLATE_SPRINT_LIGHT.md`.

---

## 🎯 Objetivo de Negócio
[Contexto: por que essa feature existe, qual problema resolve, qual é o usuário final, qual métrica de sucesso.]

## 👤 User Stories
- Como [tipo de usuário], eu quero [ação], para que [benefício].
- Como [tipo de usuário], eu quero [ação], para que [benefício].

## 🎨 Referências Visuais
- **Layout:** [Descrição ou link para `documentos_base/design_system/` — apenas referência visual, nunca copiar hex literais]
- **Design system:** componentes são compostos a partir de `src/components/ui/` seguindo [`design_system/components/CONTRACT.md`](../design_system/components/CONTRACT.md). Tokens semânticos apenas (`bg-surface-*`, `text-text-*`, `bg-action-*`, `bg-feedback-*`). Nada de hex, nada de `bg-blue-500`, nada de `p-[17px]`.
- **Componentes:** [Lista de componentes — Form, DataTable, Dialog, etc.]
- **Gold Standard:** [Módulo existente a usar como referência estrutural, ex: Leads]

## 🧬 Reference Module Compliance (se aplicável)
> Se esta sprint cria um novo módulo CRUD, especifique qual módulo existente deve servir de referência estrutural. O agente backend seguirá o `agents/skills/reference-module-copy/SKILL.md`.

- **Módulo de referência:** [ex: `src/app/dashboard/leads/` + `src/lib/actions/leads.ts`]
- **O que copiar:** estrutura de arquivos, padrão de Server Actions, padrão de error handling, padrão de UI
- **O que trocar:** nomes de tabela, schemas Zod, campos específicos do domínio

## 📋 Funcionalidades (Escopo)

### Backend

- [ ] **Banco de Dados:**
  - Tabela: `table_name`
  - Colunas: [liste com tipos]
  - Foreign keys: [liste]
  - Índices necessários: [liste]
  - RLS: [descreva políticas — ex: `user_id = auth.uid()`]
  - Migration idempotente (IF NOT EXISTS)

- [ ] **Server Actions (`src/lib/actions/[module].ts`):**
  - `create[Entity]Action` — [descrição + validação Zod]
  - `get[Entity]sAction` — [descrição + filtros/paginação]
  - `update[Entity]Action` — [descrição]
  - `delete[Entity]Action` — [descrição]

- [ ] **Integração externa (se aplicável):**
  - API: [nome]
  - Endpoint(s): [lista]
  - Fluxo: Fase 1 (Research) → Aprovação → Fase 2 (Implementation)
  - Localização: `src/lib/integrations/[api-name]/`

### Frontend

- [ ] **Rotas:**
  - `/dashboard/[module]` — listagem
  - `/dashboard/[module]/new` — criação
  - `/dashboard/[module]/[id]` — detalhe/edição

- [ ] **Componentes (`src/components/[module]/`):**
  - `[Entity]List` — [descrição]
  - `[Entity]Form` — [campos, validação client-side via react-hook-form + zodResolver]
  - `[Entity]Card` ou `[Entity]Row` — [descrição]
  - Estados: loading skeleton, empty state, error state

- [ ] **Navegação:**
  - Adicionar ao menu lateral (`src/components/layout/Sidebar.tsx` ou equivalente)
  - Breadcrumbs

## 🧪 Edge Cases (obrigatório listar)
- [ ] Estado vazio (nenhum registro): [comportamento esperado]
- [ ] Registro com dados mínimos: [comportamento]
- [ ] Registro com dados máximos (limites de tamanho): [comportamento]
- [ ] Erro de rede: [comportamento]
- [ ] Tentativa de duplicata: [comportamento]
- [ ] Usuário sem permissão: [comportamento]
- [ ] Operação concorrente (dois tabs editando o mesmo registro): [comportamento]

## 🚫 Fora de escopo
- [Liste explicitamente features que poderiam ser confundidas com esta sprint mas NÃO fazem parte dela]

## ⚠️ Critérios de Aceite
- [ ] CRUD completo funcional (create, read, update, delete)
- [ ] Validação Zod em todas as Server Actions
- [ ] RLS policies testadas (usuário A não vê dados do usuário B)
- [ ] Todos os edge cases acima tratados
- [ ] Design alinhado com Gold Standard
- [ ] `npm run build` passa sem erros
- [ ] `npm run lint` passa sem novos warnings
- [ ] **Guardian aprova o código** — este é o gate único para compliance de design system. O Guardian roda [`agents/quality/guardian.md`](../agents/quality/guardian.md) § 1a + § 1b, que por sua vez espelham [`design_system/enforcement/rules.md`](../design_system/enforcement/rules.md) e [`design_system/components/CONTRACT.md`](../design_system/components/CONTRACT.md). **Não liste regras de design system aqui** — se o Guardian aprova, o sprint passa no gate frontend.

---

## 🤖 Recomendação de Execução

> Esta seção é preenchida pelo `@sprint-creator` com base em rubrica objetiva. O Tech Lead lê ela antes de executar e pede sua escolha binária (Opção 1 ou 2).

**Análise:**
- Nível: STANDARD
- Complexity Score: [X] (0-8 = candidato Opção 1; 9+ = força Opção 2)
- Reference Module: [sim/não — caminho se sim]
- Integração com API externa: [sim/não]
- Lógica de negócio nova/ambígua: [sim/não — descrever brevemente se sim]
- Ambiguity Risk: [baixo/médio/alto]

---

### Opção 1 — SIMPLES (sem PRD)
- **Fluxo:** Tech Lead → @db-admin → (@api-integrator se aplicável) → @backend → @frontend → @guardian → gates → @git-master
- **PRD:** pulado; o próprio sprint file é o contrato
- **Modelo sugerido:** [Sonnet | Opus] — [razão breve]
- **Quando faz sentido:** [razão específica baseada na análise acima]

### Opção 2 — COMPLETA (com PRD)
- **Fluxo:** Tech Lead → @spec-writer → @sanity-checker (loop até 3×) → STOP & WAIT → execução idêntica à Opção 1
- **PRD:** gerado em `docs/prds/prd_[name].md` e validado
- **Modelo sugerido:** Opus (cold review só paga o custo em Opus)
- **Quando faz sentido:** [razão específica]

---

**Recomendação do @sprint-creator:** Opção [1 | 2] — [Sonnet | Opus]

**Justificativa:**
[2-4 linhas explicando a escolha com base na análise acima]

**Aguardando escolha do usuário:** responda ao Tech Lead com `"execute opção 1"` ou `"execute opção 2"` (ou aceite a recomendação dizendo apenas `"execute"`).
