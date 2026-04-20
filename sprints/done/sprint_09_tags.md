# Sprint 09: Tags

> **Nível:** LIGHT
> **Origem:** `docs/roadmap.md` — Sprint 09
> **Pré-requisito:** Sprint 08 (Loss Reasons) concluída.

---

## Objetivo de Negócio

Admin precisa cadastrar e gerenciar **tags coloridas** para classificar leads (ex.: "VIP", "Urgente", "Indicação"). As tags serão vinculadas a leads via tabela `lead_tags` (M2M) na Sprint 10, mas precisam estar cadastradas antes. Sem tags, o módulo de Leads não terá sistema de etiquetas.

A página placeholder em `/leads/tags` já foi criada na Sprint 07 e o submenu "Tags" já existe no sidebar. Esta sprint substitui o placeholder pelo CRUD funcional.

**Metrica de sucesso:** admin loga, acessa Leads > Tags, cria 3 tags com cores diferentes (ex.: "VIP" verde, "Urgente" vermelho, "Indicacao" azul), edita a cor de uma, desativa outra, tenta excluir uma tag sem leads vinculados (sucesso) e uma com leads vinculados (bloqueio com mensagem amigavel). Lista mostra apenas tags da propria org via RLS com preview visual da cor.

## User Stories

- Como **admin**, eu quero cadastrar tags com nome e cor, para categorizar leads visualmente.
- Como **admin**, eu quero editar o nome e a cor de uma tag existente, para ajustar a classificação.
- Como **admin**, eu quero ativar/desativar tags sem excluir (soft delete), para manter historico mas impedir uso em novos leads.
- Como **admin**, eu quero excluir tags permanentemente (hard delete), **somente** quando a tag nao esta vinculada a nenhum lead.
- Como **admin**, eu quero buscar tags por nome, para encontrar rapido em listas grandes.
- Como **user de outra organizacao**, eu NAO consigo ver nem editar tags alheias (RLS por `organization_id`).

## Referências Visuais

- **Layout — Lista:** [design_system/telas_prontas/_conteudo/entidade_lista.html](../../design_system/telas_prontas/_conteudo/entidade_lista.html)
- **Layout — Criar:** [design_system/telas_prontas/_conteudo/entidade_criar.html](../../design_system/telas_prontas/_conteudo/entidade_criar.html)
- **Layout — Editar:** [design_system/telas_prontas/_conteudo/entidade_editar.html](../../design_system/telas_prontas/_conteudo/entidade_editar.html)
- **Módulo de referência estrutural:** Loss Reasons (`src/app/(app)/leads/loss-reasons/` + `src/lib/actions/loss-reasons.ts`) — mesmo padrão de CRUD, mesma área do menu, mesma estrutura. Copiar e adaptar.
- **Design system:** tokens semânticos apenas (`bg-surface-*`, `text-text-*`, `bg-action-*`, `bg-feedback-*`). Nada de hex, nada de `bg-blue-500`, nada de `p-[17px]`. Regras autoritativas em [design_system/enforcement/rules.md](../../design_system/enforcement/rules.md) e [design_system/components/CONTRACT.md](../../design_system/components/CONTRACT.md).
- **Componentes reutilizados:** `src/components/ui/*` (Button, Input, Table, Dialog, Badge, etc).

## Discrepância Roadmap x Schema (resolvida)

O roadmap menciona "Form com name, color (picker), active", mas a tabela `tags` no banco **não possui coluna `is_active`**. Colunas atuais: `id`, `organization_id`, `name`, `color` (text, default 'gray'), `created_at`, `updated_at`. **Decisão do usuário:** adicionar coluna `is_active` via migration nesta sprint para suportar soft-delete + hard-delete condicional.

## Funcionalidades (Escopo)

### Backend

- [ ] **Banco de Dados (tabela JA EXISTE — migration apenas para adicionar `is_active`):**
  - `tags` (6 colunas atuais) — confirmadas via `docs/schema_snapshot.json`:
    - `id` uuid PK (gen_random_uuid()) · `organization_id` uuid NOT NULL · `name` text NOT NULL · `color` text NOT NULL DEFAULT 'gray' · `created_at` timestamptz DEFAULT now() · `updated_at` timestamptz DEFAULT now()
    - Indices: `idx_tags_name` (name), `idx_tags_organization` (organization_id), `tags_name_org_unique` UNIQUE (organization_id, name), `tags_pkey` (id)
    - **Unique constraint em `(organization_id, name)`** — o banco impede nomes duplicados na mesma org.
  - **Migration necessaria:** adicionar coluna `is_active boolean NOT NULL DEFAULT true` a tabela `tags`. Tags existentes ficam ativas por default.
  - **RLS:** 4 policies ja existem (SELECT/INSERT/UPDATE/DELETE por org). `@db-admin` deve confirmar que as policies enforcam `organization_id` corretamente.
  - **FK relevante:** `lead_tags.tag_id` referencia `tags.id`. O `@db-admin` deve verificar o comportamento ON DELETE da FK (RESTRICT/CASCADE/SET NULL). Isso impacta a logica de hard-delete.

- [ ] **Server Actions (`src/lib/actions/tags.ts`):**
  - Seguir os templates de `docs/templates/server_actions.md` e o contrato `ActionResponse<T>` de `docs/conventions/standards.md`.
  - Usar Loss Reasons (`src/lib/actions/loss-reasons.ts`) como referencia direta — adaptar nomes e campos.
  - `getTagsAction({ search?, isActive?, page?, pageSize? })` — lista paginada (default 20/pagina). Busca por `name` (ILIKE). Filtro: `is_active`. Ordena por `name ASC`. Retorna `ActionResponse<{ data: Tag[]; metadata: PaginationMeta }>`.
  - `getTagByIdAction(id)` — retorna tag por ID. 404 se nao pertence a org (via RLS).
  - `createTagAction(input)` — valida via Zod, seta `organization_id` via `getSessionContext()`. Tratar erro de unique constraint (nome duplicado na org) com mensagem amigavel.
  - `updateTagAction(id, input)` — atualiza nome, color e/ou is_active. Tratar erro de unique constraint.
  - `deactivateTagAction(id)` — **soft delete:** seta `is_active = false`. Sempre permitido.
  - `restoreTagAction(id)` — seta `is_active = true`.
  - `deleteTagAction(id)` — **hard delete condicional:** antes de deletar, verifica se existem registros em `lead_tags` referenciando esta tag. Se **sim** -> retorna erro amigavel: "Esta tag esta vinculada a X lead(s) e nao pode ser excluida. Desative-a em vez disso." Se **nao** -> executa DELETE real.
  - **Validacao Zod:** `name` 2-50 chars · `color` string obrigatoria (validar contra lista de cores pre-definidas) · `is_active` boolean.

### Frontend

- [ ] **Rotas (seguir paths canonicos de `docs/conventions/crud.md`):**
  - `src/app/(app)/leads/tags/page.tsx` — **substituir placeholder** pela listagem real (Server Component).
  - `src/app/(app)/leads/tags/new/page.tsx` — criacao.
  - `src/app/(app)/leads/tags/[id]/page.tsx` — edicao.

- [ ] **Componentes (`src/components/tags/`):**
  - `TagsList` — tabela com colunas: Cor (preview visual: badge ou dot colorido) · Nome · Status (badge ativo/inativo) · Criado em · Acoes (editar, desativar/ativar, excluir). Empty state ("Nenhuma tag cadastrada — crie a primeira"). Toolbar: busca debounced 300ms + CTA "Nova Tag".
  - `TagForm` — campos: name (Input), color (seletor de cor — paleta pre-definida de ~12 cores semanticas, NAO color picker livre), is_active (Switch, visivel apenas na edicao). Validacao client-side antes do submit. Preview da tag (badge com nome + cor selecionada) em tempo real no form.
  - `TagRowActions` — menu de acoes por linha (editar, desativar/ativar, excluir com confirmacao). Botao de excluir so aparece se a tag **nao** tem leads vinculados (ou exibe dialog informando a vinculacao e sugerindo desativar).
  - `TagBadge` — componente reutilizavel que renderiza uma tag como badge colorido (sera reaproveitado na Sprint 10 para exibir tags nos leads). Props: `name`, `color`.
  - **Color picker approach:** usar uma paleta fixa de cores pre-definidas (ex.: gray, red, orange, yellow, green, teal, blue, indigo, purple, pink). Armazenar o nome da cor no banco (coluna `color` text). O `TagBadge` mapeia o nome da cor para classes CSS com tokens semanticos. **NAO usar hex direto** — respeitar regra inviolavel #2 de standards.md.
  - **Regras de UI obrigatorias (de crud.md):** URL como fonte de verdade para paginacao/filtros/busca (regra #2), paginacao server-side (regra #3), toast em toda operacao com side-effect (regra #4), danger zone na edicao (regra #5, adaptar para exclusao real), sem `router.refresh()` (regra #7).

- [ ] **Navegacao:**
  - Submenu "Tags" no sidebar **ja existe** (Sprint 07). Apenas garantir que o link aponta para `/leads/tags` corretamente.
  - Breadcrumbs: `Leads / Tags / [Nova | Nome da tag]`.

## Edge Cases

- [ ] **Estado vazio (org sem tags):** lista exibe empty state com CTA "Cadastrar primeira tag".
- [ ] **Nome duplicado na mesma org:** unique constraint no banco bloqueia. Server Action deve capturar o erro e retornar mensagem amigavel: "Ja existe uma tag com este nome".
- [ ] **RLS cross-org:** user da org A tenta acessar `/leads/tags/{id-da-org-B}` -> 404.
- [ ] **Hard delete com leads vinculados:** `deleteTagAction` verifica `lead_tags` antes de deletar. Se existem registros -> erro amigavel com contagem: "Esta tag esta vinculada a X lead(s). Desative-a em vez de excluir." O usuario deve desativar (soft delete) nesse caso.
- [ ] **Hard delete sem leads vinculados:** DELETE real no banco. Confirmacao obrigatoria via dialog.
- [ ] **Soft delete (desativar):** seta `is_active = false`. Sempre permitido, independente de vinculacoes.
- [ ] **Tag desativada vinculada a lead:** a tag continua visivel no lead (historico), mas nao aparece como opcao para novas vinculacoes. Essa logica sera implementada na Sprint 10, nao nesta.
- [ ] **Erro de rede no form:** toast de erro, mantem dados preenchidos.
- [ ] **Cor default:** se o usuario nao escolher cor, usar 'gray' (default do banco).
- [ ] **Dois tabs editando a mesma tag:** last-write-wins (sem lock otimista). Aceitavel.

## Fora de escopo

- **CRUD de Leads** — Sprint 10.
- **Vinculacao tag <-> lead (`lead_tags` M2M)** — Sprint 10.
- **Filtro por tag na lista de leads** — Sprint 10.
- **Bulk import de tags** — nao previsto.
- **i18n.** Labels em pt-BR hardcoded (padrao do app hoje).
- **Color picker livre (hex/rgb)** — usar paleta fixa de cores pre-definidas.

## Criterios de Aceite

- [ ] Migration para adicionar `is_active` aplicada com sucesso.
- [ ] CRUD completo de Tags funcional: criar, listar (com busca + paginacao + filtro ativo/inativo), editar, desativar (soft delete), restaurar, excluir (hard delete condicional).
- [ ] Hard delete bloqueado quando tag tem leads vinculados em `lead_tags`, com mensagem amigavel.
- [ ] Color picker com paleta fixa funcional + preview visual na lista e no form.
- [ ] Validacao Zod em todas as Server Actions.
- [ ] Unique constraint de nome tratado com mensagem amigavel.
- [ ] RLS testada cross-org: user da org A nao ve tags da org B.
- [ ] Placeholder de `/leads/tags` substituido pela listagem real.
- [ ] `TagBadge` componente reutilizavel criado para consumo futuro na Sprint 10.
- [ ] Design alinhado com telas prontas genericas (`entidade_lista.html` / `entidade_criar.html` / `entidade_editar.html`) e com o modulo Loss Reasons como referencia estrutural. Nenhum hex/arbitrary class.
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] Guardian aprova o codigo.

---

## Recomendacao de Execucao

**Analise:**
- Nivel: LIGHT
- Complexity Score: **5** (DB +1: migration para adicionar `is_active`; API +2: 7 Server Actions copiando padrao de loss-reasons + logica de verificacao de FK antes do hard-delete; UI +2: form com color picker + preview de badge + componente reutilizavel TagBadge; Logica +0: verificacao de FK e condicional simples; Dependencias +0: sidebar ja tem submenu, modulo de referencia existe)
- Reference Module: **sim** — `src/app/(app)/leads/loss-reasons/` + `src/lib/actions/loss-reasons.ts`
- Integracao com API externa: **nao**
- Logica de negocio nova/ambigua: **nao** — CRUD com soft/hard-delete condicional + color picker, copia mecanica de Loss Reasons com adicoes pontuais

**Opcao 1 forcada** (LIGHT). Fluxo: Tech Lead -> @db-admin (confirmacao RLS) -> @backend (copiando padrao de loss-reasons) -> @frontend+ (copiando padrao de loss-reasons + telas prontas + color picker) -> @guardian -> gates -> @git-master

**Modelo sugerido:** Sonnet 4.6 — copia mecanica com adicao pontual de color picker, sem decisoes arquiteturais.

---

## 🔄 Execucao

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| Banco de dados | `@db-admin` | ✅ Concluido | `supabase/migrations/20260420100000_add_is_active_to_tags.sql` |
| Server Actions | `@backend` | ✅ Concluido | `src/lib/actions/tags.ts`, `src/lib/tags/constants.ts` |
| Frontend | `@frontend+` | ✅ Concluido | pages: `tags/page.tsx`, `tags/new/page.tsx`, `tags/[id]/page.tsx`; components: `TagsList`, `TagForm`, `TagBadge`, `TagRowActions`, `TagsToolbar`, `TagsSortPanel`, `TagsSortableHeader`, `sort-utils` |
| Guardian | `@guardian` | ✅ Concluido | CODE REVIEW: APPROVED (0 violações) |
| Git | `@git-master` | ✅ Concluido | sprint file movido para `sprints/done/` |

**Legenda:** ⬜ Pendente · ▶️ Em andamento · ✅ Concluido · ⏸️ Aguarda review
