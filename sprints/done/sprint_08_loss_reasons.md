# Sprint 08: Loss Reasons

> **Nível:** LIGHT
> **Origem:** `docs/roadmap.md` — Sprint 08
> **Pré-requisito:** Sprint 07 (Lead Origins) concluída.

---

## Objetivo de Negócio

Admin precisa cadastrar e gerenciar os **motivos de perda de leads** (ex.: preço alto, concorrente escolhido, sem resposta, timing inadequado) para que, ao marcar um lead como perdido (Sprint 10/13), seja obrigatório selecionar o motivo. Sem motivos cadastrados, o pipeline não terá rastreabilidade de por que leads são perdidos — dado essencial para ajustes na abordagem comercial.

A página placeholder em `/leads/loss-reasons` já foi criada na Sprint 07 e o submenu "Motivos de Perda" já existe no sidebar. Esta sprint substitui o placeholder pelo CRUD funcional.

**Métrica de sucesso:** admin loga, acessa Leads > Motivos de Perda, cria 3 motivos (ex.: "Preço alto", "Concorrente", "Sem retorno"), edita um, desativa outro, e a lista mostra apenas motivos da própria org via RLS.

## User Stories

- Como **admin**, eu quero cadastrar motivos de perda com nome, para categorizar por que leads foram perdidos.
- Como **admin**, eu quero ativar/desativar motivos sem excluir, para manter histórico mas impedir uso em novos leads perdidos.
- Como **admin**, eu quero buscar motivos por nome, para encontrar rápido em listas grandes.
- Como **user de outra organização**, eu NÃO consigo ver nem editar motivos alheios (RLS por `organization_id`).

## Referências Visuais

- **Layout — Lista:** [design_system/telas_prontas/_conteudo/entidade_lista.html](../../design_system/telas_prontas/_conteudo/entidade_lista.html)
- **Layout — Criar:** [design_system/telas_prontas/_conteudo/entidade_criar.html](../../design_system/telas_prontas/_conteudo/entidade_criar.html)
- **Layout — Editar:** [design_system/telas_prontas/_conteudo/entidade_editar.html](../../design_system/telas_prontas/_conteudo/entidade_editar.html)
- **Módulo de referência estrutural:** Lead Origins (`src/app/(app)/leads/origins/` + `src/lib/actions/lead-origins.ts`) — mesmo padrão de CRUD, mesma área do menu, mesma estrutura. Copiar e adaptar.
- **Design system:** tokens semânticos apenas (`bg-surface-*`, `text-text-*`, `bg-action-*`, `bg-feedback-*`). Nada de hex, nada de `bg-blue-500`, nada de `p-[17px]`. Regras autoritativas em [design_system/enforcement/rules.md](../../design_system/enforcement/rules.md) e [design_system/components/CONTRACT.md](../../design_system/components/CONTRACT.md).
- **Componentes reutilizados:** `src/components/ui/*` (Button, Input, Switch, Table, Dialog, Badge, etc).

## Discrepância Roadmap × Schema

O roadmap menciona "Form com name, description, active", mas a tabela `loss_reasons` no banco (confirmada via `docs/schema_snapshot.json`) **não possui coluna `description`**. Colunas reais: `id`, `organization_id`, `name`, `is_active`, `created_at`. Esta sprint segue o schema real — sem campo description no form. Se o usuário quiser adicionar a coluna, será via `@db-admin` antes da execução.

## Funcionalidades (Escopo)

### Backend

- [ ] **Banco de Dados (tabela JÁ EXISTE, não criar migration de tabela):**
  - `loss_reasons` (5 colunas) — confirmadas via `docs/schema_snapshot.json`:
    - `id` uuid PK (gen_random_uuid()) · `organization_id` uuid NOT NULL · `name` text NOT NULL · `is_active` boolean DEFAULT true · `created_at` timestamptz DEFAULT now()
    - Índice: `idx_loss_reasons_org` em `organization_id`
    - **Sem unique constraint em `(organization_id, name)`** — diferente de `lead_origins`. Avaliar se faz sentido adicionar para evitar duplicatas.
  - **RLS:** 4 policies já existem (SELECT/INSERT/UPDATE/DELETE por org). `@db-admin` deve confirmar no início da sprint que as policies enforcam `organization_id` corretamente. Se estiver OK, **nenhuma migration é necessária**.

- [ ] **Server Actions (`src/lib/actions/loss-reasons.ts`):**
  - Seguir os templates de `docs/templates/server_actions.md` e o contrato `ActionResponse<T>` de `docs/conventions/standards.md`.
  - Usar Lead Origins (`src/lib/actions/lead-origins.ts`) como referência direta — adaptar nomes e campos.
  - `getLossReasonsAction({ search?, isActive?, page?, pageSize? })` — lista paginada (default 20/página). Busca por `name` (ILIKE). Filtro: `is_active`. Ordena por `created_at DESC`. Retorna `ActionResponse<{ data: LossReason[]; metadata: PaginationMeta }>`.
  - `getLossReasonByIdAction(id)` — retorna motivo por ID. 404 se não pertence à org (via RLS).
  - `createLossReasonAction(input)` — valida via Zod, seta `organization_id` via `getSessionContext()`.
  - `updateLossReasonAction(id, input)` — atualiza nome e/ou is_active.
  - `deleteLossReasonAction(id)` — **soft delete:** seta `is_active = false`. Não exclui do banco.
  - `restoreLossReasonAction(id)` — seta `is_active = true`.
  - **Validação Zod:** `name` 2-100 chars · `is_active` boolean.

### Frontend

- [ ] **Rotas (seguir paths canônicos de `docs/conventions/crud.md`):**
  - `src/app/(app)/leads/loss-reasons/page.tsx` — **substituir placeholder** pela listagem real (Server Component).
  - `src/app/(app)/leads/loss-reasons/new/page.tsx` — criação.
  - `src/app/(app)/leads/loss-reasons/[id]/page.tsx` — edição.

- [ ] **Componentes (`src/components/loss-reasons/`):**
  - `LossReasonsList` — tabela com colunas: Nome · Status (badge ativo/inativo) · Criado em · Ações (editar, desativar/ativar). Empty state ("Nenhum motivo de perda cadastrado — crie o primeiro"). Toolbar: busca debounced 300ms + CTA "Novo Motivo".
  - `LossReasonForm` — campos: name (Input), is_active (Switch). Validação client-side antes do submit (regra dura #6 de crud.md).
  - `LossReasonRowActions` — menu de ações por linha (editar, ativar/desativar).
  - **Regras de UI obrigatórias (de crud.md):** URL como fonte de verdade para paginação/filtros/busca (regra #2), paginação server-side (regra #3), toast em toda operação com side-effect (regra #4), danger zone na edição (regra #5), sem `router.refresh()` (regra #7).

- [ ] **Navegação:**
  - Submenu "Motivos de Perda" no sidebar **já existe** (Sprint 07). Apenas garantir que o link aponta para `/leads/loss-reasons` corretamente.
  - Breadcrumbs: `Leads / Motivos de Perda / [Novo | Nome do motivo]`.

## Edge Cases

- [ ] **Estado vazio (org sem motivos):** lista exibe empty state com CTA "Cadastrar primeiro motivo de perda".
- [ ] **Nome duplicado na mesma org:** como não há unique constraint, permitir (comportamento atual do banco). Se o usuário preferir bloquear, `@db-admin` adiciona constraint antes.
- [ ] **RLS cross-org:** user da org A tenta acessar `/leads/loss-reasons/{id-da-org-B}` → 404.
- [ ] **Desativar motivo que já está vinculado a leads (futuro):** permitido — o motivo continua no histórico do lead, apenas não aparece como opção para novas perdas. Essa lógica será implementada na Sprint 10/13 (Leads/Pipeline), não nesta.
- [ ] **Erro de rede no form:** toast de erro, mantém dados preenchidos.
- [ ] **Dois tabs editando o mesmo motivo:** last-write-wins (sem lock otimista). Aceitável.

## Fora de escopo

- **CRUD de Leads** — Sprint 10.
- **Pipeline Kanban (modal de perda com motivo obrigatório)** — Sprint 13.
- **Vinculação motivo ↔ lead** — Sprint 10/13 (FK `loss_reason_id` em `leads`).
- **Bulk import de motivos** — não previsto.
- **i18n.** Labels em pt-BR hardcoded (padrão do app hoje).
- **Coluna `description`** — não existe no schema atual. Fora de escopo a menos que o usuário peça criação.

## Critérios de Aceite

- [ ] CRUD completo de Loss Reasons funcional: criar, listar (com busca + paginação), editar, desativar (soft), restaurar.
- [ ] Validação Zod em todas as Server Actions.
- [ ] RLS testada cross-org: user da org A não vê motivos da org B.
- [ ] Placeholder de `/leads/loss-reasons` substituído pela listagem real.
- [ ] Design alinhado com telas prontas genéricas (`entidade_lista.html` / `entidade_criar.html` / `entidade_editar.html`) e com o módulo Lead Origins como referência estrutural. Nenhum hex/arbitrary class.
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] Guardian aprova o código.

---

## Recomendação de Execução

**Análise:**
- Nível: LIGHT
- Complexity Score: **3** (DB +0: tabela já existe com RLS, zero migrations; API +2: 6 Server Actions copiando padrão de lead-origins; UI +1: form mínimo de 1 campo + lista padrão; Lógica +0: sem regra de negócio nova; Dependências +0: sidebar já tem submenu, módulo de referência existe)
- Reference Module: **sim** — `src/app/(app)/leads/origins/` + `src/lib/actions/lead-origins.ts`
- Integração com API externa: **não**
- Lógica de negócio nova/ambígua: **não** — CRUD puro com soft-delete, cópia mecânica de Lead Origins

**Opção 1 forçada** (LIGHT). Fluxo: Tech Lead → @db-admin (confirmação RLS) → @backend (copiando padrão de lead-origins) → @frontend+ (copiando padrão de lead-origins + telas prontas) → @guardian → gates → @git-master

**Modelo sugerido:** Sonnet 4.6 — cópia mecânica, sem decisões arquiteturais.

---

## 🔄 Execução

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| Banco de dados | `@db-admin` | ✅ Concluído | Tabela + RLS já existem, sem migration |
| Server Actions | `@backend` | ✅ Concluído | `src/lib/actions/loss-reasons.ts`, `src/lib/loss-reasons/constants.ts` |
| Frontend | `@frontend+` | ✅ Concluído | `src/app/(app)/leads/loss-reasons/page.tsx`, `new/page.tsx`, `[id]/page.tsx`, `src/components/loss-reasons/*` |
| Guardian | `@guardian` | ✅ Concluído | APPROVED — sem violações |
| Git | `@git-master` | ⬜ Pendente | — |

**Legenda:** ⬜ Pendente · ▶️ Em andamento · ✅ Concluído · ⏸️ Aguarda review
