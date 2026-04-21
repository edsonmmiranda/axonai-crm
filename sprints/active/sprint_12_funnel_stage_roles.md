# Sprint 12: Funnel Stage Roles — Entrada, Ganho e Perdido (STANDARD)

> **Nível:** STANDARD
> **Origem:** solicitação do usuário — 2026-04-21
> **Pré-requisito:** Sprint 11 (Funnels CRUD) concluída.

---

## 🎯 Objetivo de Negócio

Cada funil precisa ter exatamente três estágios com papel especial definido:

- **Entrada** — estágio onde os leads caem por padrão ao entrar no funil
- **Ganho** — estágio que representa conversão bem-sucedida (antes chamado "venda ganha")
- **Perdido** — estágio que representa encerramento sem conversão (antes chamado "venda perdida")

Os demais estágios são neutros (sem papel especial). Essa configuração é pré-requisito para o Pipeline Kanban (sprint futura) saber onde posicionar leads automaticamente.

**Métrica de sucesso:** admin configura um funil, marca um estágio como Entrada, um como Ganho e um como Perdido. O sistema valida que cada papel existe exatamente uma vez. A configuração é salva e exibida corretamente na edição.

---

## 👤 User Stories

- Como **admin**, eu quero marcar qual estágio de um funil é o ponto de entrada dos leads, para que novos leads sejam automaticamente posicionados no estágio correto.
- Como **admin**, eu quero marcar qual estágio representa "Ganho", para que o pipeline identifique leads convertidos.
- Como **admin**, eu quero marcar qual estágio representa "Perdido", para que o pipeline identifique leads sem conversão.
- Como **admin**, ao criar ou editar um funil, quero receber um erro claro se não configurei os três papéis obrigatórios, para não salvar um funil incompleto.

---

## 🎨 Referências Visuais

- **Módulo de referência estrutural:** Sprint 11 — `src/components/funnels/FunnelStagesEditor.tsx` e `src/lib/actions/funnel-stages.ts`
- **Design system:** tokens semânticos apenas. Nenhum hex, `bg-blue-500` ou `p-[17px]`. Regras em [`design_system/enforcement/rules.md`](../../design_system/enforcement/rules.md).
- **Componentes reutilizados:** `src/components/ui/select.tsx` (Select do Radix) — mesmo padrão já usado no campo "Situação" do FunnelForm.
- **Apresentação visual do role:** um `Select` pequeno por linha de estágio com opções: "— Neutro —", "Entrada", "Ganho", "Perdido". O role selecionado deve ter feedback visual diferenciado (badge ou ícone) para facilitar a leitura rápida.

---

## 🧬 Reference Module Compliance

- **Módulo de referência:** `src/components/funnels/FunnelStagesEditor.tsx` + `src/lib/actions/funnel-stages.ts`
- **O que reutilizar:** estrutura do `useFieldArray`, padrão de upsert de stages, schemas Zod existentes
- **O que adicionar:** campo `stage_role` no schema Zod, validação de unicidade dos três papéis, Select de role por linha de estágio no editor

---

## 📋 Funcionalidades (Escopo)

### Backend

- [ ] **Banco de Dados — Migration (`supabase/migrations/`):**
  - Adicionar coluna `stage_role text DEFAULT NULL CHECK (stage_role IN ('entry', 'won', 'lost'))` na tabela `funnel_stages`
  - Índice parcial de unicidade: `CREATE UNIQUE INDEX idx_funnel_stages_role ON funnel_stages (funnel_id, stage_role) WHERE stage_role IS NOT NULL`
    - Garante no banco que cada funil tem no máximo 1 estágio com cada role
  - Migration idempotente (`IF NOT EXISTS` / `DO $$ BEGIN ... EXCEPTION ... END $$`)
  - RLS existente cobre a nova coluna — nenhuma policy nova necessária

- [ ] **Server Actions — atualizar `src/lib/actions/funnel-stages.ts`:**
  - Adicionar `stage_role: z.enum(['entry', 'won', 'lost']).nullable().optional()` ao schema `StageUpsertInput`
  - Atualizar `updateFunnelStagesAction`: incluir `stage_role` no upsert
  - **Validação de negócio:** antes do upsert, verificar que o array de stages contém exatamente 1 `entry`, 1 `won` e 1 `lost`. Retornar `ActionResponse` com erro descritivo se a condição não for atendida:
    - Ex.: `"O funil deve ter exatamente um estágio de Entrada, um de Ganho e um de Perdido."`

- [ ] **Server Actions — atualizar `src/lib/actions/funnels.ts`:**
  - Incluir `stage_role` nas queries de `getFunnelByIdAction` (retorno de stages) e `createFunnelAction` (receber e persistir `stage_role` junto com as stages)
  - `FunnelWithStages.stages[]` deve expor `stage_role: 'entry' | 'won' | 'lost' | null`
  - Aplicar a mesma validação dos três papéis obrigatórios no `createFunnelAction` antes de persistir

### Frontend

- [ ] **`src/components/funnels/FunnelStagesEditor.tsx`:**
  - Adicionar um `Select` por linha de estágio com as opções:
    - `""` → "— Neutro —" (valor nulo)
    - `"entry"` → "Entrada"
    - `"won"` → "Ganho"
    - `"lost"` → "Perdido"
  - O Select deve ser compacto (não ocupar mais de ~120px de largura) e ficar à direita do Input de nome, antes dos botões de ação
  - Quando um role já está atribuído a outro estágio, o Select desse estágio deve desabilitar aquele valor — impedindo seleção duplicada no client antes mesmo de submeter
  - Badge/ícone visual por role ao lado do número do estágio:
    - Entrada: ícone `LogIn` ou `ArrowRightToLine` (Lucide) — cor `text-feedback-info-fg`
    - Ganho: ícone `Trophy` ou `CheckCircle2` (Lucide) — cor `text-feedback-success-fg`
    - Perdido: ícone `XCircle` (Lucide) — cor `text-feedback-danger-fg`

- [ ] **`src/components/funnels/FunnelForm.tsx`:**
  - Atualizar o `StageSchema` para incluir `stage_role: z.enum(['entry', 'won', 'lost']).nullable().optional()`
  - Atualizar validação do `FormSchema`: verificar (via `z.superRefine` ou `.refine`) que o array de stages contém exatamente 1 de cada role. Mensagem de erro clara ao usuário no nível do array de stages
  - Passar `stage_role` no payload de `createFunnelAction` e `updateFunnelStagesAction`

---

## 🧪 Edge Cases

- [ ] **Funil com menos de 3 estágios:** não é possível ter os 3 roles — o form deve exibir mensagem orientando o usuário a adicionar estágios suficientes antes de salvar.
- [ ] **Dois estágios com o mesmo role no client:** o Select de cada linha deve desabilitar options já usadas em outros estágios. Se o estado ficar inconsistente de alguma forma, a validação Zod e a validação do Server Action devem capturar.
- [ ] **Salvar sem configurar todos os roles:** erro de validação no form antes do submit; se passar, Server Action retorna erro amigável.
- [ ] **Estágio com role `entry` removido:** o botão de remover estágio não impede isso — a validação no submit captura. Mensagem deve indicar qual role está faltando.
- [ ] **Reordenar estágios (drag ou botões):** não afeta o `stage_role` — o role é propriedade do estágio, não da posição.
- [ ] **Índice único do banco (`idx_funnel_stages_role`) rejeitando duplicata:** o Server Action deve capturar o erro de constraint e retornar mensagem amigável, não vazar `error.message` do Postgres.
- [ ] **Funis já cadastrados (dados existentes sem `stage_role`):** a coluna é `DEFAULT NULL`, então dados existentes ficam com `stage_role = NULL`. Ao editar um funil antigo, o editor exibe todos os estágios como "Neutro" e exige que o admin configure os papéis antes de salvar.

---

## 🚫 Fora de escopo

- **Uso do `stage_role` no Pipeline Kanban** — apenas configuração nesta sprint; o consumo é da sprint de Pipeline.
- **Regra de negócio "lead entra no estágio de Entrada automaticamente"** — sprint de Pipeline.
- **Relatórios por role** — sprint futura.
- **Mais de um estágio com o mesmo role por funil** — explicitamente proibido; o índice único e a validação garantem isso.
- **Renomear os labels "Ganho" / "Perdido"** — hardcoded nesta sprint; personalização é melhoria futura.

---

## ⚠️ Critérios de Aceite

- [ ] Migration idempotente aplicada: coluna `stage_role` com CHECK constraint + índice único parcial em `funnel_stages`.
- [ ] `createFunnelAction` e `updateFunnelStagesAction` validam e persistem `stage_role` corretamente.
- [ ] Validação dupla (client Zod + Server Action): exatamente 1 `entry`, 1 `won`, 1 `lost` por funil.
- [ ] `FunnelStagesEditor` exibe Select de role por estágio com desabilitação de options já usadas.
- [ ] Badge/ícone visual correto por role (Entrada / Ganho / Perdido).
- [ ] Dados existentes (stage_role NULL) exibidos como "Neutro" sem quebrar a tela de edição.
- [ ] Erro do índice único do Postgres não vaza `error.message` ao cliente.
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] Guardian aprova o código.

---

## 🤖 Recomendação de Execução

**Análise:**
- Nível: STANDARD
- Complexity Score: **7**
  - DB: campo em tabela existente +1, índice único parcial +1 = 2
  - API: modificar Server Actions existentes +2, validação de negócio nova +2 = 4
  - UI: modificar componente existente +1 = 1
- Reference Module: **sim** — Sprint 11 (`src/components/funnels/`, `src/lib/actions/funnel-stages.ts`)
- Integração com API externa: **não**
- Lógica de negócio nova/ambígua: **moderada, não ambígua** — a regra "exatamente 1 de cada role" é clara; implementação requer cuidado com validação dupla e constraint de banco
- Ambiguity Risk: **baixo** — papéis definidos explicitamente pelo usuário ("Ganho" e "Perdido"), schema de extensão claro

---

### Opção 1 — SIMPLES (sem PRD)
- **Fluxo:** Tech Lead → @db-admin → @backend → @frontend+ → @guardian → gates → @git-master
- **PRD:** pulado; este sprint file é o contrato
- **Modelo sugerido:** Sonnet 4.6 — Reference Module presente, extensão de módulo já estável
- **Quando faz sentido:** extensão direta de Sprint 11, sem ambiguidade de requisitos, padrão de upsert já estabelecido

### Opção 2 — COMPLETA (com PRD)
- **Fluxo:** Tech Lead → @spec-writer → @sanity-checker (loop até 3×) → STOP & WAIT → execução idêntica à Opção 1
- **PRD:** gerado em `prds/prd_funnel_stage_roles.md` e validado
- **Modelo sugerido:** Opus
- **Quando faz sentido:** se houver dúvida sobre o comportamento de UI (Select com desabilitação dinâmica) ou sobre a estratégia de constraint (banco vs. aplicação)

---

**Recomendação do @sprint-creator:** Opção 1 — Sonnet 4.6

**Justificativa:**
Score 7 com Reference Module presente encaixa na regra 6 (Opção 1 sugerida). Os requisitos foram definidos explicitamente na conversa (nomes "Ganho" e "Perdido", comportamento de seleção exclusiva por role), o padrão de upsert de stages já existe em `funnel-stages.ts`, e a validação "exatamente 1 de cada" é uma regra objetiva sem margem de interpretação. PRD não agrega valor aqui.

**Aguardando escolha do usuário:** responda ao Tech Lead com `"execute opção 1"` ou `"execute opção 2"` (ou aceite a recomendação dizendo apenas `"execute"`).

---

## 🔄 Execução

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| Banco de dados | `@db-admin` | ⬜ Pendente | — |
| Server Actions | `@backend` | ⬜ Pendente | — |
| Frontend | `@frontend+` | ⬜ Pendente | — |
| Guardian | `@guardian` | ⬜ Pendente | — |
| Git | `@git-master` | ⬜ Pendente | — |

**Legenda:** ⬜ Pendente · ▶️ Em andamento · ✅ Concluído · ⏸️ Aguarda review
