# Design System

Esta pasta é a **fonte canônica de verdade** para a linguagem visual do framework. É consumida tanto por desenvolvedores humanos quanto por agentes de IA (`@frontend`, `@guardian`, `@spec-writer`). Tudo que é visual — cores, espaçamento, tipografia, comportamento de componente — ou vive aqui, ou é derivado daqui.

---

## Arquitetura — três camadas

O design system é organizado como três camadas discretas, em ordem da mais abstrata para a mais concreta:

```
┌─────────────────────────────────────────────┐
│  1. PRIMITIVOS   tokens/primitives.json     │  Valores crus: escalas de cor, spacing,
│     ─ sem significado, só números           │  type scale, radii, sombras, motion
├─────────────────────────────────────────────┤
│  2. SEMÂNTICOS   tokens/semantic.*.json     │  Significado: surface.base, text.primary,
│     ─ referencia primitivos por nome        │  action.primary.bg, feedback.danger.fg
├─────────────────────────────────────────────┤
│  3. OUTPUTS      generated/*                │  Consumido pelo código: variáveis CSS,
│     ─ derivado dos semânticos pelo build    │  config Tailwind, tipos TS
└─────────────────────────────────────────────┘
```

**A regra:** código consome camada 3. Agentes e humanos editam camada 1 (para rebrandar) ou camada 2 (para remapear significado). Camada 3 é reescrita automaticamente pelo step de build. Nunca edite camada 3 à mão.

### Por que três camadas?

- **Primitivos** permitem rebrandar o produto inteiro trocando um único arquivo. Um tenant whitelabel ou uma segunda marca é um novo `primitives.brand.json` com o mesmo formato.
- **Semânticos** permitem trocar temas (light/dark/alto contraste) sem tocar nos primitivos e sem reescrever componentes. Componentes sempre referenciam `text.primary`, não `color.neutral.900`.
- **Outputs** permitem que a codebase real consuma tokens sem acoplamento com o formato JSON. Se você trocar de engine de tokens amanhã, os componentes continuam funcionando.

Se uma única camada pudesse tratar todas as três responsabilidades, nós não precisaríamos de três. Não podem; a separação é load-bearing.

---

## Mapa de pastas

| Caminho | Propósito | Editado por |
|---|---|---|
| [tokens/primitives.json](tokens/primitives.json) | Valores crus (paleta, spacing, type scale, radii, sombras, motion) | Designer / dono da marca |
| [tokens/semantic.light.json](tokens/semantic.light.json) | Mapeamento semântico do modo light (surface, text, border, action, feedback) | Mantenedor do DS |
| [tokens/semantic.dark.json](tokens/semantic.dark.json) | Mapeamento semântico do modo dark (mesmos nomes do light) | Mantenedor do DS |
| [tokens/README.md](tokens/README.md) | Contrato de authoring de tokens (naming, formato W3C, como adicionar um token) | — |
| [build/style-dictionary.config.mjs](build/style-dictionary.config.mjs) | Config do pipeline de transformação | Mantenedor do DS |
| [build/package.json](build/package.json) | Dependências do build | — |
| [build/README.md](build/README.md) | Como o pipeline funciona e como rodá-lo | — |
| [generated/variables.css](generated/variables.css) | Custom properties CSS (um bloco por tema) — **gerado** | 🤖 build |
| [generated/tailwind.tokens.ts](generated/tailwind.tokens.ts) | Extensão do tema Tailwind — **gerado** | 🤖 build |
| [generated/tokens.d.ts](generated/tokens.d.ts) | Tipos TypeScript para tokens semânticos — **gerado** | 🤖 build |
| [components/quick-reference.md](components/quick-reference.md) | **Quick reference consolidado** — templates, code patterns, tokens e regras em um único arquivo | `@frontend` |
| [components/CONTRACT.md](components/CONTRACT.md) | Regras para construir componentes + padrões de referência + guia de decisão de tokens | `@frontend` |
| [components/catalog/_index.yaml](components/catalog/_index.yaml) | **Índice master** de todos os componentes (atoms, molecules, organisms, utilities, templates) | `@frontend` |
| [components/catalog/](components/catalog/) | YAMLs individuais por componente — code pattern, tokens usados, variantes | `@frontend` |
| [components/recipes/](components/recipes/) | Guias passo a passo para montar páginas (CRUD, relatório, kanban) | `@frontend` |
| [components/recipes/examples/](components/recipes/examples/) | **Exemplos completos** de páginas montadas em TSX (listing, form, kanban) | `@frontend` |
| [enforcement/rules.md](enforcement/rules.md) | Regras concretas de ESLint / Stylelint / a11y que impedem o código de derivar do contrato | `@guardian` |
| [docs/theming.md](docs/theming.md) | Como theming light/dark/multi-brand funciona de ponta a ponta | — |
| [docs/anti-patterns.md](docs/anti-patterns.md) | Coisas que parecem tentadoras e nunca devem ser feitas | — |

---

## Consumindo o design system (para agentes e humanos escrevendo componentes)

**Você nunca importa de `tokens/`.** Componentes consomem apenas a camada 3:

1. **Variáveis CSS** — `var(--ds-text-primary)`, `var(--ds-surface-raised)`.
2. **Classes Tailwind** que referenciam essas variáveis — `bg-surface-raised`, `text-primary`, `border-default`, `ring-focus`. A config do Tailwind em `generated/tailwind.tokens.ts` conecta tudo isso.
3. **Tipos TypeScript** — `import type { SemanticColor } from '@/design-system/tokens'`.

O contrato para escrever componentes vive em [`components/CONTRACT.md`](components/CONTRACT.md). Leia antes de escrever qualquer componente.

---

## Atualizando o design system

### Rebranding (trocar cores para um novo tenant / produto)

Edite [`tokens/primitives.json`](tokens/primitives.json). A camada semântica e todos os componentes continuam funcionando, desde que você preserve o formato (mesmas escalas, mesmas chaves). Rode o build; commite os outputs regenerados.

### Adicionando um novo token semântico

1. Adicione **tanto** em `semantic.light.json` quanto em `semantic.dark.json`. Todo token semântico deve ter valor em cada tema — valores faltando são erro de build.
2. Rode o build.
3. Documente o uso pretendido do novo token em [`components/CONTRACT.md`](components/CONTRACT.md) se mudar o contrato de authoring de componente.

### Mudando o que um token semântico significa

Isso é uma breaking change para componentes que o consomem. Faça a mudança nos arquivos semânticos, rode o build, rode a suíte de regressão visual (veja [`enforcement/rules.md`](enforcement/rules.md)) e anuncie no changelog do projeto.

---

## Regras inegociáveis

Estas são enforçadas pelo `@guardian` e pelas regras de lint em [`enforcement/rules.md`](enforcement/rules.md). Existem para que o design system não possa silenciosamente derivar enquanto a codebase cresce.

1. **Nenhum literal hex, rgb, hsl ou oklch em código de aplicação.** Em lugar nenhum. Nem em `className`, nem em `style`, nem em arquivos CSS fora de `generated/`. Use tokens semânticos.
2. **Nenhum valor arbitrário do Tailwind** — `p-[17px]`, `w-[350px]`, `bg-[#fff]` são todos rejeitados. Use as escalas de spacing, size e color.
3. **Componentes consomem tokens semânticos, nunca primitivos.** `bg-blue-500` está errado; `bg-action-primary` está certo. Primitivos existem para que a camada semântica os referencie — não para que componentes os consumam.
4. **Ícones vêm do Lucide.** Sem SVGs customizados para ícones que já existem no Lucide, sem segunda biblioteca de ícones.
5. **Fontes vêm do primitivo `font.family`.** Sem `font-['Some Font']`.
6. **Todo par de cores usado na UI deve passar no contraste WCAG AA.** Isso é checado em tempo de build a partir do JSON de tokens — veja [`enforcement/rules.md`](enforcement/rules.md).

Se um componente genuinamente precisa de algo que o DS não provê, a resposta é adicionar um token semântico (com review) — não burlar as regras localmente.

---

## Para agentes de IA

Se você é um agente (`@frontend`, `@guardian`, `@spec-writer`, `@sanity-checker`) lendo este arquivo, sua ordem de leitura obrigatória é:

1. Este `README.md` — entenda o modelo de três camadas.
2. **[`components/quick-reference.md`](components/quick-reference.md)** — documento consolidado com tudo que você precisa para montar uma página (templates, code patterns, tokens, regras). **Leia este antes de abrir qualquer outro arquivo.**
3. [`components/CONTRACT.md`](components/CONTRACT.md) — regras detalhadas (incluindo guia de decisão de tokens) para quando o quick-reference não for suficiente.
4. [`components/catalog/_index.yaml`](components/catalog/_index.yaml) — índice de todos os componentes disponíveis.
5. [`enforcement/rules.md`](enforcement/rules.md) — as regras que você deve enforçar ao revisar.
6. [`docs/anti-patterns.md`](docs/anti-patterns.md) — coisas que parecem corretas e não são.

### Para criar uma nova página

1. Identifique o tipo de página (CRUD listing, formulário, relatório, kanban).
2. Leia o **[`components/quick-reference.md`](components/quick-reference.md)** — contém layouts, code patterns e tokens em um único arquivo.
3. Leia o **exemplo completo** em [`components/recipes/examples/`](components/recipes/examples/) para ver uma página inteira montada em TSX.
4. Leia o recipe correspondente em [`components/recipes/`](components/recipes/) para os passos específicos de customização.
5. Para componentes não cobertos no quick-reference, abra o YAML individual em [`components/catalog/`](components/catalog/) — os templates já incluem os paths completos dos YAMLs.

### Exemplos completos de páginas (TSX)

| Tipo | Exemplo |
|---|---|
| Listing Page | [`recipes/examples/listing-page.tsx.example`](components/recipes/examples/listing-page.tsx.example) |
| Form Create | [`recipes/examples/form-create-page.tsx.example`](components/recipes/examples/form-create-page.tsx.example) |
| Form Edit | [`recipes/examples/form-edit-page.tsx.example`](components/recipes/examples/form-edit-page.tsx.example) |
| Print Page | [`recipes/examples/print-page.tsx.example`](components/recipes/examples/print-page.tsx.example) |
| Kanban Board | [`recipes/examples/kanban-page.tsx.example`](components/recipes/examples/kanban-page.tsx.example) |
| Dashboard | [`recipes/examples/dashboard-page.tsx.example`](components/recipes/examples/dashboard-page.tsx.example) |

### Referências rápidas

- Quick reference consolidado: [`components/quick-reference.md`](components/quick-reference.md)
- Tokens semânticos existentes: `tokens/semantic.light.json`
- Classes Tailwind disponíveis: `generated/tailwind.tokens.ts`
- Exceções de layout permitidas: seção no `CONTRACT.md`
- Guia de decisão de tokens: seção no [`CONTRACT.md`](components/CONTRACT.md#guia-de-decisão-de-tokens--quando-usar-cada-um)

Você **não pode** abrir `documentos_base/design_system/*.html` e copiar valores hex dali — aqueles mockups existem como referência *visual* apenas; os valores canônicos estão aqui.
