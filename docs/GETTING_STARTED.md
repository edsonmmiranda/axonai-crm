# 🚀 Getting Started — Como usar o Framework

Manual prático de **como iniciar um projeto novo** e **como operar o framework no dia a dia**.

Este documento é intencionalmente curto. Não re-documenta regras que já vivem em outros arquivos — ele aponta para eles na ordem certa, na hora certa. A fonte autoritativa de workflow é sempre [`agents/00_TECH_LEAD.md`](../agents/00_TECH_LEAD.md).

**Leitores:** você (humano, operador do framework).

---

## 🧭 O que é este framework

Um **shell vazio e reutilizável** para construir SaaS sobre Next.js + Supabase usando Claude como Tech Lead orquestrador. Não tem código de aplicação ainda — o primeiro sprint de cada projeto novo é um **bootstrap sprint** que cria `package.json`, `src/`, Next.js, cliente Supabase, layout base.

A filosofia: **você descreve o que quer em arquivos de sprint, o Tech Lead orquestra personas especializadas (`@frontend`, `@backend`, `@db-admin`, etc.) para executar, e 5 validation gates garantem qualidade antes de fechar o sprint.**

Visão completa da arquitetura: [`CLAUDE.md`](../CLAUDE.md) + [`agents/00_TECH_LEAD.md`](../agents/00_TECH_LEAD.md).

---

## ✅ Pré-requisitos

Antes de clonar o framework para um projeto novo, você precisa ter:

- **Node.js** 20+ instalado
- **Git** configurado (`user.name` e `user.email` em `~/.gitconfig`)
- **Conta Supabase** (gratuita serve) — https://supabase.com
- **Claude Code** instalado (CLI, desktop app, ou extensão IDE)
- Um **repositório git** criado (local ou remoto no GitHub)

Não precisa de Supabase CLI instalada globalmente — o framework assume que você roda `supabase db push` localmente ou usa o dashboard.

---

## 🔄 Ciclo de vida de um projeto

```
┌──────────────────────────────────────────────────────────┐
│  FASE 1 — Preparação (uma vez, manual, antes do Claude)  │
│  • Clone do framework                                     │
│  • git init + primeiro commit                             │
│  • Criar projeto no Supabase                              │
│  • Escrever sprint_01_bootstrap.md                        │
└──────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────┐
│  FASE 2 — Bootstrap sprint (Claude executa)               │
│  • Tech Lead cria .env.example                            │
│  • Cria package.json, src/, Next.js, Supabase client      │
│  • Cria layout base (DashboardShell vazio)                │
└──────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────┐
│  FASE 3 — Configurar o projeto (manual, depois do boot)  │
│  • cp .env.example .env.local → preencher Supabase keys   │
│  • Ajustar tokens do design system (cores da marca)       │
│  • Colocar logo em src/assets/brands/                     │
│  • Colocar mocks de design em design_refs/                │
└──────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────┐
│  FASE 4 — Sprint de feature (Claude executa) — REPETE    │
│  • Escrever sprint_NN_[feature].md                        │
│  • Acionar Tech Lead                                      │
│  • Revisar, aprovar gates, fechar sprint                  │
└──────────────────────────────────────────────────────────┘
                          ↓
                  (volta pra Fase 4)
```

---

## 📘 FASE 1 — Preparação (uma vez)

### 1.1 Clone o framework

```bash
git clone [url-do-framework] meu-projeto
cd meu-projeto
rm -rf .git
git init
git add .
git commit -m "chore: initial commit from framework"
```

### 1.2 Crie o projeto no Supabase

1. Acesse https://supabase.com/dashboard
2. New project → preencha nome, senha do banco, região
3. Espere terminar de provisionar (~2 min)
4. Em **Project Settings → API**, copie:
   - Project URL (`https://xxxxx.supabase.co`)
   - `anon public` key
   - `service_role` key

Guarde essas 3 strings — você vai usá-las na Fase 3.

### 1.3 Escreva o sprint de bootstrap

Crie `sprints/sprint_01_bootstrap.md`. Formato mínimo:

```markdown
# Sprint 01 — Bootstrap

## Goal
Criar estrutura inicial do Next.js + Supabase.

## Scope
- package.json com stack definido em docs/stack.md
- Estrutura src/app/, src/components/, src/lib/
- Cliente Supabase em src/lib/supabase/
- Layout base: DashboardShell vazio (sem menu ainda)
- Gerar .env.example na raiz (template documentado)

## Out of scope
- Qualquer CRUD
- Menu de navegação (sprint próprio)
- Design tokens finais (humano ajusta depois)
```

Não precisa mais que isso pro bootstrap. Detalhe demais só gera scope creep.

---

## 🚀 FASE 2 — Bootstrap sprint (Claude)

Abra o Claude Code no diretório do projeto e digite exatamente:

```
Tech Lead, execute sprints/sprint_01_bootstrap.md
```

O gatilho obrigatório é **começar a mensagem com "Tech Lead..."** ([CLAUDE.md](../CLAUDE.md)). Sem isso, o agente fica em observer mode e não faz nada.

O Tech Lead vai:
1. Detectar que é bootstrap (sem `package.json`/`src/`)
2. Criar `.env.example` a partir de [`docs/templates/env.example`](templates/env.example)
3. Scaffoldar Next.js + Supabase + layout base
4. Pular GATE 2 (ainda não tem `npm run build` pra rodar)
5. Fechar sprint e instruir você a preencher `.env.local`

Ao final você terá: `package.json`, `src/`, `.env.example`, mas `.env.local` **ainda não existe** — é você quem cria na fase seguinte.

---

## ⚙️ FASE 3 — Configurar o projeto (uma vez, manual)

### 3.1 Credenciais do Supabase

```bash
cp .env.example .env.local
```

Abra `.env.local` e substitua os placeholders pelas 3 strings que você copiou do dashboard do Supabase na 1.2. A documentação de cada variável está no próprio arquivo (`docs/templates/env.example` tem a versão comentada).

> ⚠️ **Regra dura:** o Tech Lead nunca edita `.env.local`. Só você.

### 3.2 Design system — tokens da marca

Ajuste as variáveis CSS em [`design_system/`](../design_system/) para as cores da sua marca. O framework usa **tokens semânticos** (ex.: `text-primary`, `surface-raised`) — você muda os valores-raiz, todos os componentes herdam.

### 3.3 Logo e design refs (opcional)

- Logo em `src/assets/brands/` (se o layout usa)
- Mockups / referências visuais em `design_refs/` (para `@frontend` consultar)

### 3.4 Primeira migration

Se o bootstrap criou uma migration inicial, rode:

```bash
supabase db push
```

(ou aplique manualmente via SQL editor do Supabase).

---

## 🔁 FASE 4 — Sprint de feature (loop principal)

A partir daqui, o ciclo se repete para cada feature.

> 💡 **Atalho:** pra mudança pequena (ajuste visual, typo, bug pontual) você **não precisa** de sprint file — basta chat direto com o Tech Lead. Ver seção [Pedidos de manutenção (Workflow B)](#pedidos-de-manutenção-sem-sprint-file--workflow-b) mais abaixo.

### 4.1 Escreva o sprint

**Recomendado: sprint minimalista.** Você não precisa escrever PRD estruturado — escreva a intenção em 1-3 linhas e deixe o [`@spec-writer`](../agents/specs/spec-writer.md) expandir pra PRD completo.

Crie `sprints/sprint_NN_[feature].md`:

```markdown
Criar tela de Funcionário.
Referência: src/app/leads/ (mesma estrutura, campos diferentes).
```

Ou pra bug fix:

```markdown
O botão "Excluir" na lista de leads não mostra toast de confirmação ao sucesso.
```

É isso. O Tech Lead, ao executar, delega pro `@spec-writer` que:
1. Lê o módulo-referência que você citou
2. Gera PRD completo (campos, migration, rotas, out-of-scope)
3. **Mostra o PRD pra você aprovar** antes de executar
4. Só depois parte pra build

Você revisa o PRD expandido, pede ajustes se quiser, aprova. Scope creep fica contido porque o `@spec-writer` **sempre** lista out-of-scope explícito.

**Dicas de sprint minimalista bem escrito:**
- Cite o módulo-referência quando existir (`src/app/leads/` ou [`docs/templates/reference_module/`](templates/reference_module/) se é o primeiro CRUD)
- Mencione campos-chave se forem diferentes do espelho (ex.: *"com CPF e data de admissão"*)
- Se tem mockup, aponte o caminho em `design_refs/`
- Evite descrever implementação (HTML, classes Tailwind, validação) — isso é trabalho do `@spec-writer` + `@frontend`

**Quando usar PRD estruturado direto** (pular o `@spec-writer`): só se você já sabe **exatamente** todos os campos, regras e fora-de-escopo, e quer economizar o round-trip de aprovação. Templates em [`docs/templates/`](templates/):
- [`prd_light.md`](templates/prd_light.md) — sprint simples
- [`prd_standard.md`](templates/prd_standard.md) — CRUD padrão
- [`prd_complete.md`](templates/prd_complete.md) — feature grande com integrações

Na dúvida, use minimalista. É mais rápido e o PRD sai melhor.

### 4.2 Acione o Tech Lead

```
Tech Lead, execute sprints/sprint_NN_[feature].md
```

O Tech Lead vai escolher automaticamente entre:
- **Workflow A** (PRD → spec → build → 5 gates) para features
- **Workflow B** (LIGHT, rápido) para bug fix, refactor pequeno, manutenção

Você não precisa escolher — ele detecta pelo formato do sprint.

### 4.3 Acompanhe os gates

Durante execução, o Tech Lead reporta cada gate:
- **GATE 1** — DB dry-run (migration válida?)
- **GATE 2** — `npm run build` + `npm run lint`
- **GATE 3** — Integração de APIs externas (se houver)
- **GATE 4** — Guardian (design tokens, convenções)
- **GATE 5** — Verificação manual de design (você confirma visualmente)

Se um gate falha, ele faz rollback e retry — ou escala pra você se não consegue resolver.

### 4.4 Feche o sprint

Ao fim, o Tech Lead:
- Atualiza narrativa em `docs/architecture_state.md`
- Roda `node scripts/generate-architecture-inventory.mjs` (inventário mecânico)
- Commita tudo

Próximo sprint parte do estado novo.

---

## 💬 Como conversar com o Tech Lead

### Gatilho obrigatório
Toda mensagem que espera ação começa com **"Tech Lead..."**. Sem isso ele fica em observer mode.

### Pedidos de manutenção (sem sprint file) — Workflow B

Pra tarefas pequenas fora do ciclo de sprint, **não precisa criar sprint file**. Basta chat direto:

```
Tech Lead, [descrição da tarefa]
```

O Tech Lead detecta que é pedido direto e roteia pro **Workflow B (LIGHT)** automaticamente: pula preflight pesado, pula `@spec-writer` e PRD, delega direto pro agente certo (`@frontend`, `@backend`, etc.), roda gates essenciais (build/lint + guardian) e reporta.

**Exemplos reais de pedido Workflow B:**

```
Tech Lead, aumenta o tamanho do botão "Salvar" na edição de leads — está pequeno no mobile.

Tech Lead, o botão de excluir na lista de funcionários não mostra toast quando a exclusão dá certo.

Tech Lead, troca o label "Email" por "E-mail corporativo" no formulário de cadastro.

Tech Lead, tem um typo em src/app/login/page.tsx — "Entar" deveria ser "Entrar".

Tech Lead, onde fica a lógica que calcula o ticket médio? Só me mostra o arquivo.

Tech Lead, refatora a função formatCurrency em src/lib/format.ts pra suportar moeda arg.
```

Reparou que nenhum desses precisa de PRD? Workflow B existe pra isso.

**Quando é Workflow B (chat direto, sem sprint file):**
- Ajuste visual (tamanho, cor, espaçamento, label)
- Typo, texto, copy
- Bug pontual ("X não funciona quando Y")
- Refactor pequeno e local (1-2 arquivos)
- Pergunta sobre o código ("onde está X?", "como Y funciona?")

**Quando precisa de sprint file + Workflow A:**
- Feature nova (CRUD, tela, fluxo completo)
- Migration de banco / mudança de schema
- Integração com API externa
- Qualquer coisa que toque ≥3 arquivos ou cruze camadas (UI + backend + DB)

**Na dúvida:** escreva o pedido em chat. Se o Tech Lead julgar que é grande demais pra Workflow B, ele te pede pra criar sprint file. Ele não improvisa feature grande sem PRD.

### Posso chamar `@frontend` direto, sem passar pelo Tech Lead?

**Não.** O harness é single-threaded com Tech Lead como orquestrador único (regra dura do [`CLAUDE.md`](../CLAUDE.md)). Toda mensagem começa com *"Tech Lead, …"* — ele decide qual agente delega. Benefício: gates de qualidade sempre rodam, mesmo em mudança "pequena" (porque "mudança pequena" quebra build mais vezes do que a gente admite).

### Mudar de ideia no meio
Se o Tech Lead está indo pra um caminho que você não quer, interrompa e redirecione. Ele prefere perguntar a improvisar, mas não adivinha o que você mudou de ideia.

### Quando ele pergunta, responda direto
Se ele escala com "AMBIGUIDADE: X pode ser A ou B, qual?", responda A ou B. Não responda "faz o que achar melhor" — isso é o que o protocolo de ambiguidade existe pra evitar.

---

## 🔍 Onde procurar quando algo dá errado

| Problema | Leia primeiro |
|---|---|
| Não entendo o workflow A vs B | [`agents/00_TECH_LEAD.md`](../agents/00_TECH_LEAD.md) |
| Tech Lead parou no preflight por `.env.local` | [`docs/templates/env.example`](templates/env.example) — cada variável documentada |
| Agente violou uma convenção | [`docs/conventions/standards.md`](conventions/standards.md) — regras invioláveis |
| Quero entender a regra X de CRUD | [`docs/conventions/crud.md`](conventions/crud.md) |
| Como criar módulo novo igual a outro | [`agents/skills/reference-module-copy/SKILL.md`](../agents/skills/reference-module-copy/SKILL.md) |
| Aprendizado de armadilha que pegou alguém | [`docs/APRENDIZADOS.md`](APRENDIZADOS.md) |
| Estado atual do projeto (o que foi construído) | [`docs/architecture_state.md`](architecture_state.md) |

---

## 🧾 Convenções ao escrever sprints

Curto é melhor que longo. Um sprint bem escrito cabe em 2-3 linhas — o `@spec-writer` expande o resto.

**Bom:**
> Criar tela de Funcionário.
> Referência: `src/app/leads/` (mesma estrutura, campos: nome, CPF, cargo, data de admissão).

**Também bom** (quando não tem referência ainda):
> Criar dashboard principal com 3 cards de métrica (total de clientes, vendas do mês, ticket médio).
> Layout baseado em `design_refs/dashboard_v1.png`.

**Ruim:**
> 8 páginas descrevendo cada campo do formulário, cada classe Tailwind, cada validação. Isso vira scope creep garantido e o `@spec-writer` vai ignorar metade porque detalhe de implementação não é trabalho seu.

Confie nos agentes — eles conhecem as convenções. Descreva **o quê** e **por quê**, não **como**.

---

## 🧠 Regras de ouro

1. **Só começa com "Tech Lead..."** — sem isso, nada acontece.
2. **Um sprint por vez.** Não empilhe 3 sprints em paralelo esperando mágica.
3. **Nunca edite código gerado durante um sprint em andamento.** Espere fechar.
4. **`.env.local` é seu — ninguém mais toca.** Só você edita credenciais.
5. **Out of scope é tão importante quanto Scope.** Liste o que NÃO entra.
6. **Se o Tech Lead pergunta, responda.** Não mande ele "decidir sozinho".
7. **Leia `docs/APRENDIZADOS.md` de vez em quando.** Armadilhas documentadas = armadilhas que você não pisa duas vezes.
