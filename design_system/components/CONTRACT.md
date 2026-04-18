# Contrato de authoring de componentes

Este arquivo define as regras que todo componente no framework deve seguir para permanecer alinhado com o design system. É lido por `@frontend+` (que escreve componentes) e `@guardian` (que os revisa). Se você está escrevendo ou revisando um componente, esta é leitura obrigatória.

A filosofia: **componentes são finas camadas de estilo sobre primitivos headless, montadas a partir de tokens semânticos**. Não reinventamos padrões de interação; nós os herdamos de uma biblioteca headless comprovada e os pintamos com nossos tokens.

## Índice

1. [A stack](#a-stack) — tecnologias usadas
2. [As quatro regras](#as-quatro-regras) — tokens, headless, cva, composição
3. [Padrões de referência](#padrões-de-referência) — Button, Input, Card, Form Field, Badge, Alert, Dialog
4. [Catálogo de componentes](#catálogo-de-componentes-atomic-design) — ponteiros para YAMLs em `catalog/`
5. [Tokens semânticos — referência rápida](#tokens-semânticos--referência-rápida) — tabela de classes Tailwind
6. [Exceções de layout](#exceções-de-layout--valores-arbitrários-permitidos) — valores arbitrários permitidos
7. [Quando adicionar um novo token](#quando-adicionar-um-novo-token-semântico)
8. [Checklist de PR](#checklist-antes-de-submeter-um-pr-de-componente)

---

## A stack

| Camada | Escolha | Por quê |
|---|---|---|
| Comportamento headless | **Radix Primitives** (ou React Aria quando Radix não cobre o padrão) | Acessibilidade está resolvida. Não reconstruímos gestão de foco, tratamento de teclado ou ARIA. |
| Estilização | **Classes Tailwind referenciando tokens semânticos** | Um sistema de estilização, enforçável por lint. |
| Helper de composição | **`cn()`** (de `clsx` + `tailwind-merge`) | Mescla classes Tailwind com segurança, resolve conflitos. |
| Variantes | **`class-variance-authority` (`cva`)** | Mapas de variantes tipados em vez de strings condicionais ad-hoc. |
| Ícones | **Lucide** apenas | Uma biblioteca de ícones, larguras e tamanhos consistentes. |
| Formulários | **react-hook-form + Zod** | Já é o default do framework. |

O modelo de distribuição do Shadcn (copiar o fonte para dentro do seu repo, ser dono do código, customizar livremente) é a postura default. Não instalamos bibliotecas de componentes; instalamos primitivos headless e escrevemos nossos próprios wrappers finos.

---

## As quatro regras

### 1. Tokens semânticos, sempre

Toda cor, raio, sombra, espaçamento e tamanho de tipo usado numa lista de classes de componente deve vir de um token semântico. Você os referencia via classes Tailwind geradas a partir de `generated/tailwind.tokens.ts`.

```tsx
// ✅ Correto
<div className="bg-surface-raised text-text-primary border border-default rounded-lg shadow-sm p-4">
  ...
</div>

// ❌ Errado — literais hex, valores arbitrários
<div className="bg-[#ffffff] text-[#0d141b] border-[#e7edf3] rounded-[12px] p-[16px]">
  ...
</div>

// ❌ Errado — consumindo primitivos diretamente
<div className="bg-blue-500 text-white">
  ...
</div>
```

O caso `bg-blue-500` merece ser sublinhado: mesmo que `blue-500` seja um token real, ele vive na camada primitiva. Componentes não podem referenciá-lo. O token correto é `action.primary.bg` (que, hoje, por acaso mapeia para `blue.500`, mas amanhã pode não mapear — esse é o ponto da indireção).

### 2. Comportamento headless, skin semântico

Quando um componente tem qualquer interação não-trivial — focus trap, navegação por teclado, roving tabindex, portal, click-outside, estado de campo de formulário — ele deve ser construído sobre um primitivo headless. Não reconstrua isso a partir de `div`s.

```tsx
// ✅ Correto — Radix é dono do comportamento, nós somos donos da aparência
import * as DialogPrimitive from "@radix-ui/react-dialog";

export const DialogContent = forwardRef<...>(({ className, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 bg-surface-inverse/60" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
        "bg-surface-overlay text-text-primary border border-default rounded-xl shadow-xl",
        "p-6 max-w-lg w-full",
        className
      )}
      {...props}
    />
  </DialogPrimitive.Portal>
));
```

```tsx
// ❌ Errado — dialog hand-rolled, sem focus trap, sem tratamento de escape, sem portal
export function Dialog({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 ..." onClick={onClose}>
      <div className="...">{children}</div>
    </div>
  );
}
```

### 3. Variantes via `cva`, não strings condicionais

Qualquer componente com mais de uma variante visual (button, badge, alert, input) usa `class-variance-authority` para declarar suas variantes e estados em um único mapa tipado. Isso torna a API auto-documentada e previne drift de variantes.

```tsx
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva(
  // base — aplica a toda variante
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary:   "bg-action-primary text-action-primary-fg hover:bg-action-primary-hover active:bg-action-primary-active",
        secondary: "bg-action-secondary text-action-secondary-fg border border-action-secondary-border hover:bg-action-secondary-hover active:bg-action-secondary-active",
        ghost:     "bg-transparent text-action-ghost-fg hover:bg-action-ghost-hover active:bg-action-ghost-active",
        danger:    "bg-action-danger text-action-danger-fg hover:bg-action-danger-hover active:bg-action-danger-active",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
    compoundVariants: [
      { variant: "primary", className: "disabled:bg-action-disabled disabled:text-action-disabled-fg" },
    ],
  }
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
```

Qualquer componente que aceita props `variant` ou `size` deve usar este padrão. `className={isPrimary ? "..." : "..."}` ad-hoc é um code smell.

### 4. Componha, não reimplemente

Antes de criar um novo componente, cheque se ele pode ser montado a partir dos existentes. Uma filter bar é um `Stack` de `Input`, `Select`, `Button`. Um modal de confirmação é `Dialog` + `Text` + dois `Button`s. Adicionar um novo componente leaf exige review; compor os existentes não.

Se a coisa que você precisa genuinamente não existe, a ordem de preferência é:

1. Compor a partir de componentes DS existentes.
2. Compor a partir de um primitivo Radix + tokens DS.
3. Pedir a um mantenedor para adicionar ao DS. Não construa dentro de uma pasta de feature torcendo para ninguém notar.

---

## Padrões de referência

Estas são as implementações mínimas viáveis de cada componente comum, usando os tokens de `generated/tailwind.tokens.ts`. Copie-as como ponto de partida quando a sprint de bootstrap montar a pasta `src/components/ui/`.

### Button

Veja o exemplo `cva` na regra 3 acima. Tamanhos: `sm` / `md` / `lg`. Variantes: `primary` / `secondary` / `ghost` / `danger`. Suporte a ícone via `gap-2` + ícone Lucide como filho.

### Input

```tsx
<input
  className={cn(
    "h-10 w-full rounded-md px-3 text-sm",
    "bg-field text-field-fg placeholder:text-field-placeholder",
    "border border-field-border hover:border-field-border-hover",
    "focus-visible:outline-none focus-visible:border-field-border-focus focus-visible:shadow-focus",
    "disabled:bg-field-disabled disabled:text-text-disabled disabled:cursor-not-allowed",
    "aria-[invalid=true]:border-field-border-error",
    className
  )}
  {...props}
/>
```

### Card

```tsx
<div className="bg-surface-raised text-text-primary border border-default rounded-lg shadow-sm">
  <div className="px-6 pt-6 pb-4 border-b border-subtle">
    <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
    {description && <p className="text-sm text-text-secondary mt-1">{description}</p>}
  </div>
  <div className="p-6">{children}</div>
</div>
```

### Campo de formulário (label + input + erro)

```tsx
<div className="flex flex-col gap-1.5">
  <label htmlFor={id} className="text-sm font-medium text-text-primary">
    {label}
    {required && <span className="text-action-danger ml-0.5">*</span>}
  </label>
  <Input id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} {...props} />
  {error && (
    <p id={`${id}-error`} className="text-xs text-feedback-danger-fg">
      {error}
    </p>
  )}
</div>
```

### Badge

```tsx
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      intent: {
        neutral: "bg-surface-sunken text-text-secondary",
        success: "bg-feedback-success-bg text-feedback-success-fg",
        warning: "bg-feedback-warning-bg text-feedback-warning-fg",
        danger:  "bg-feedback-danger-bg text-feedback-danger-fg",
        info:    "bg-feedback-info-bg text-feedback-info-fg",
      },
    },
    defaultVariants: { intent: "neutral" },
  }
);
```

### Alert

```tsx
<div
  role="alert"
  className={cn(
    "flex gap-3 p-4 rounded-md border",
    intent === "success" && "bg-feedback-success-bg border-feedback-success-border text-feedback-success-fg",
    intent === "warning" && "bg-feedback-warning-bg border-feedback-warning-border text-feedback-warning-fg",
    intent === "danger"  && "bg-feedback-danger-bg border-feedback-danger-border text-feedback-danger-fg",
    intent === "info"    && "bg-feedback-info-bg border-feedback-info-border text-feedback-info-fg",
  )}
>
  <Icon className="size-5 shrink-0" />
  <div className="flex-1">
    {title && <p className="font-semibold">{title}</p>}
    <p className="text-sm">{children}</p>
  </div>
</div>
```

### Dialog / Sheet / Popover

Sempre construídos sobre o primitivo Radix correspondente (`@radix-ui/react-dialog`, `@radix-ui/react-popover`). O padrão na regra 2 acima é a forma canônica. Nunca reimplemente portal, focus trap ou tratamento de escape.

---

## Catálogo de componentes (Atomic Design)

O catálogo completo de componentes está em **arquivos YAML estruturados**, organizados por nível atômico. Cada YAML contém: nome, descrição, tokens usados, variantes com code patterns e notas.

### Onde encontrar

| O que precisa | Onde ler |
|---|---|
| **Índice de todos os componentes** | [`catalog/_index.yaml`](catalog/_index.yaml) — leia este primeiro |
| Atoms (19 componentes) | [`catalog/atoms/`](catalog/atoms/) |
| Molecules (25 componentes) | [`catalog/molecules/`](catalog/molecules/) |
| Organisms (22 componentes) | [`catalog/organisms/`](catalog/organisms/) |
| Utilities (3 componentes) | [`catalog/utilities/`](catalog/utilities/) |
| Templates (6 layouts) | [`catalog/templates/`](catalog/templates/) |
| **Recipes (como montar uma página)** | [`recipes/`](recipes/) |

### Recipes disponíveis

| Recipe | Quando usar |
|---|---|
| [`crud-completo.yaml`](recipes/crud-completo.yaml) | Criar um módulo CRUD inteiro (listing + create + edit + print) |
| [`pagina-relatorio.yaml`](recipes/pagina-relatorio.yaml) | Criar uma página de relatório/impressão |
| [`kanban-pipeline.yaml`](recipes/kanban-pipeline.yaml) | Criar uma página de pipeline/board kanban |
| [`dashboard.yaml`](recipes/dashboard.yaml) | Criar a página inicial de dashboard |

### Ordem de leitura para criar uma nova página

1. Leia o recipe correspondente ao tipo de página
2. Abra o template YAML referenciado para ver o layout
3. Para cada organismo listado, abra o YAML para ver o code pattern
4. Para cada molecule/atom filho, abra o YAML correspondente
5. Consulte a tabela de tokens abaixo para verificar classes disponíveis

---

## Tokens semânticos — referência rápida

Abaixo está um resumo dos tokens disponíveis. Para a definição completa com valores, veja [`tokens/semantic.light.json`](../tokens/semantic.light.json). Para as classes Tailwind geradas, veja [`generated/tailwind.tokens.ts`](../generated/tailwind.tokens.ts).

### Cores

| Grupo | Tokens | Classes Tailwind |
|---|---|---|
| **Surface** | base, raised, sunken, overlay, inverse | `bg-surface-{token}` |
| **Text** | primary, secondary, muted, inverse, link, disabled | `text-text-{token}` |
| **Border** | default, strong, subtle, focus | `border-border`, `border-border-{token}` |
| **Action Primary** | bg, bg-hover, bg-active, fg | `bg-action-primary`, `text-action-primary-fg` |
| **Action Secondary** | bg, bg-hover, bg-active, fg, border | `bg-action-secondary`, `text-action-secondary-fg` |
| **Action Ghost** | bg-hover, bg-active, fg | `bg-action-ghost-hover`, `text-action-ghost-fg` |
| **Action Danger** | bg, bg-hover, bg-active, fg | `bg-action-danger`, `text-action-danger-fg` |
| **Action Disabled** | bg, fg | `bg-action-disabled`, `text-action-disabled-fg` |
| **Field** | bg, bg-disabled, fg, placeholder, border, border-hover, border-focus, border-error | `bg-field`, `text-field-fg`, `border-field-border` |
| **Feedback Success** | bg, border, fg, solid-bg, solid-fg | `bg-feedback-success-bg`, `text-feedback-success-fg` |
| **Feedback Warning** | bg, border, fg, solid-bg, solid-fg | `bg-feedback-warning-bg`, `text-feedback-warning-fg` |
| **Feedback Danger** | bg, border, fg, solid-bg, solid-fg | `bg-feedback-danger-bg`, `text-feedback-danger-fg` |
| **Feedback Info** | bg, border, fg, solid-bg, solid-fg | `bg-feedback-info-bg`, `text-feedback-info-fg` |
| **Feedback Accent** | bg, border, fg, solid-bg, solid-fg | `bg-feedback-accent-bg`, `text-feedback-accent-fg` |

### Tipografia

| Token | Classe Tailwind |
|---|---|
| font-size: xs, sm, base, lg, xl, 2xl, 3xl, 4xl | `text-xs` ... `text-4xl` |
| font-weight: regular, medium, semibold, bold | `font-regular` ... `font-bold` |
| line-height: tight, snug, normal, relaxed | `leading-tight` ... `leading-relaxed` |
| letter-spacing: tight, normal, wide | `tracking-tight` ... `tracking-wide` |
| font-family: sans, mono | `font-sans`, `font-mono` |

### Layout

| Token | Classe Tailwind |
|---|---|
| border-radius: none, sm, md, lg, xl, full | `rounded-none` ... `rounded-full` |
| box-shadow: sm, md, lg, xl, focus | `shadow-sm` ... `shadow-focus` |
| z-index: base, dropdown, sticky, overlay, modal, popover, toast | `z-base` ... `z-toast` |

### Motion

| Token | Classe Tailwind |
|---|---|
| duration: fast, normal, slow | `duration-fast` ... `duration-slow` |
| easing: standard, emphasis, exit | `ease-standard` ... `ease-exit` |

---

## Guia de decisão de tokens — quando usar cada um

Esta seção resolve a dúvida "qual token uso aqui?" para os cenários mais comuns. Consulte-a **antes** de escolher uma classe Tailwind. Se nenhuma linha abaixo cobre seu caso, provavelmente você precisa de um novo token semântico (veja [Quando adicionar um novo token](#quando-adicionar-um-novo-token-semântico)).

### Surface (fundos)

| Cenário | Token | Classe Tailwind | Por quê |
|---|---|---|---|
| Fundo da página inteira | `surface.base` | `bg-surface-base` | Nível mais baixo de elevação — tudo "flutua" sobre ele |
| Cards, painéis, sidebar, header | `surface.raised` | `bg-surface-raised` | Um degrau acima de base — cria percepção de elevação |
| Áreas recuadas dentro de um card (thead, código, input bg) | `surface.sunken` | `bg-surface-sunken` | Visualmente "afundado" — indica conteúdo incrustado |
| Dialogs, popovers, menus flutuantes | `surface.overlay` | `bg-surface-overlay` | Sobre tudo — sempre com `shadow-xl` e `z-modal`/`z-popover` |
| Tooltips, callouts escuros | `surface.inverse` | `bg-surface-inverse` | Fundo escuro em contexto claro — use com `text-text-inverse` |

**Regra prática:** pense em camadas físicas empilhadas. base → raised → overlay, de baixo para cima. sunken é "para dentro" de raised. inverse é "outro mundo".

### Text (cores de texto)

| Cenário | Token | Classe Tailwind |
|---|---|---|
| Títulos, corpo principal, labels de campo | `text.primary` | `text-text-primary` |
| Metadata, captions, descrições auxiliares | `text.secondary` | `text-text-secondary` |
| Placeholders, ícones decorativos inativos | `text.muted` | `text-text-muted` |
| Texto sobre fundo escuro/primary | `text.inverse` | `text-text-inverse` |
| Links inline em texto corrido | `text.link` | `text-text-link` |
| Labels desabilitados | `text.disabled` | `text-text-disabled` |

**Regra prática:** se é a informação principal → `primary`. Se é contexto auxiliar → `secondary`. Se é decorativo ou placeholder → `muted`.

### Border (bordas)

| Cenário | Token | Classe Tailwind |
|---|---|---|
| Borda de cards, inputs, dividers padrão | `border.default` | `border-border` |
| Bordas enfatizadas, hover de input, separadores fortes | `border.strong` | `border-border-strong` |
| Separadores de baixo contraste (entre rows de tabela, linhas sutis) | `border.subtle` | `border-border-subtle` |
| Anel de foco em elementos interativos | `border.focus` | `border-border-focus` |

### Action (botões e controles interativos)

| Cenário | Grupo de tokens | Quando usar |
|---|---|---|
| CTA principal, ação positiva (Salvar, Criar, Confirmar) | `action.primary` | A ação que você **quer** que o usuário faça |
| Ações alternativas (Cancelar, Filtrar, Exportar) | `action.secondary` | Opções válidas mas não primárias |
| Ações terciárias, ícones de ação, links de ação | `action.ghost` | Ações frequentes que não devem competir visualmente |
| Ações destrutivas (Excluir, Remover, Revogar) | `action.danger` | Qualquer ação irreversível ou destrutiva |
| Estados desabilitados de qualquer botão | `action.disabled` | Quando a ação não está disponível |

**Regra prática:** no máximo **um** `primary` por região visual. Se há dois botões lado a lado, um é `primary` e o outro é `secondary` ou `ghost`.

### Field (campos de formulário)

| Cenário | Token | Classe Tailwind |
|---|---|---|
| Fundo de inputs, selects, textareas | `field.bg` | `bg-field` |
| Campo desabilitado | `field.bg-disabled` | `bg-field-disabled` |
| Texto digitado pelo usuário | `field.fg` | `text-field-fg` |
| Placeholder | `field.placeholder` | `placeholder:text-field-placeholder` |
| Borda padrão do campo | `field.border` | `border-field-border` |
| Borda no hover | `field.border-hover` | `hover:border-field-border-hover` |
| Borda quando focado | `field.border-focus` | `focus-visible:border-field-border-focus` |
| Borda quando inválido | `field.border-error` | `aria-[invalid=true]:border-field-border-error` |

### Feedback (alertas, badges, status)

| Cenário | Grupo | Variante leve (bg + fg) | Variante sólida (solid) |
|---|---|---|---|
| Sucesso, concluído, ativo | `feedback.success` | `bg-feedback-success-bg text-feedback-success-fg` | `bg-feedback-success-solid-bg text-feedback-success-solid-fg` |
| Alerta, atenção, pendente | `feedback.warning` | `bg-feedback-warning-bg text-feedback-warning-fg` | `bg-feedback-warning-solid-bg text-feedback-warning-solid-fg` |
| Erro, falha, rejeitado | `feedback.danger` | `bg-feedback-danger-bg text-feedback-danger-fg` | `bg-feedback-danger-solid-bg text-feedback-danger-solid-fg` |
| Informação, dica, neutro-positivo | `feedback.info` | `bg-feedback-info-bg text-feedback-info-fg` | `bg-feedback-info-solid-bg text-feedback-info-solid-fg` |
| Destaque categórico, pipeline, labels de cor | `feedback.accent` | `bg-feedback-accent-bg text-feedback-accent-fg` | `bg-feedback-accent-solid-bg text-feedback-accent-solid-fg` |

**Quando usar leve vs sólido:** use a variante leve (fundo pastel + texto colorido) para badges, alerts e banners inline. Use a variante sólida (fundo vibrante + texto branco/escuro) para indicadores pequenos, dots, contadores e elementos que precisam chamar atenção imediata.

---

## Exceções de layout — valores arbitrários permitidos

A regra 2 proíbe valores arbitrários do Tailwind (`w-[300px]`, `text-[10px]`). Porém, alguns valores de **layout estrutural** não têm token semântico equivalente porque são específicos de um contexto, não de um papel visual. Esses são documentados aqui como exceções explícitas.

| Valor arbitrário | Onde é usado | Justificativa | Ação recomendada |
|---|---|---|---|
| `w-[300px] 2xl:w-[340px]` | Kanban Column | Largura fixa de coluna é layout, não semântico | Criar extensão `w-kanban-col` no `tailwind.config.ts` |
| `max-w-[1400px]` | Print Page container | Largura máxima de impressão A4 landscape | Criar extensão `max-w-print` no `tailwind.config.ts` |
| `text-[10px]` | Timestamp Chip, Counter Badge, Avatar overflow | Tamanho menor que `text-xs` (12px) | Criar token `font-size-2xs` nos primitivos, ou usar `text-xs` |
| `left-[15px]` | Activity Timeline vertical line | Alinhamento com centro do ícone de 32px | Aceitável como cálculo de posição contextual |
| `size-[72px]` | Quick Action Button (dashboard) | Tamanho fixo de botão quadrado — layout contextual | Criar extensão `size-quick-action` no `tailwind.config.ts` |
| `min-h-[160px]` | Gradient CTA Card (dashboard) | Altura mínima para proporção visual do card | Aceitável como exceção contextual |

**Regra**: ao encontrar uma exceção de layout no catálogo, o agente deve:
1. Verificar se a extensão Tailwind já foi criada (ex: `w-kanban-col`)
2. Se sim, usar a extensão — não o valor arbitrário
3. Se não, criar a extensão ou usar o valor arbitrário com comentário `/* layout exception */`

---

## Quando adicionar um novo token semântico

Você se pega escrevendo um `className` repetido para um propósito específico que não casa com nenhum token existente. Por exemplo, você precisa de um "fundo de sidebar" que fica entre `surface.base` e `surface.sunken`.

A escolha é:

- **Isso é genuinamente um papel novo no design system?** Então adicione um novo token semântico (`surface.sidebar`) nos arquivos light e dark, rebuilde, documente neste arquivo.
- **É um one-off?** Então não pertence ao DS — questione se o design em si está inconsistente. Um one-off é um cheiro ruim.

Nunca adicione um token escopado por componente como `sidebar-bg` na camada semântica. Tokens semânticos são sobre papéis (surface, text, action, feedback), não sobre componentes.

---

## Checklist antes de submeter um PR de componente

- [ ] Nenhum literal hex, `rgb()`, `hsl()` ou `oklch()` em qualquer arquivo.
- [ ] Nenhum valor arbitrário do Tailwind (`p-[17px]`, `bg-[#...]`, `w-[350px]`).
- [ ] Todas as cores vêm de classes semânticas (`bg-surface-raised`, `text-text-primary`, etc.).
- [ ] Todo espaçamento, raio, sombra e tipo vêm da escala padrão.
- [ ] Componentes interativos são construídos sobre um primitivo Radix ou React Aria.
- [ ] Variantes (se houver) são declaradas via `cva`, não condicionais ad-hoc.
- [ ] Ícones são do Lucide.
- [ ] Estado de foco é visível e usa `shadow-focus`.
- [ ] Estado desabilitado é visível e usa tokens `action.disabled`.
- [ ] Dark mode funciona — verificado togglando `data-theme="dark"` no `<html>`.
- [ ] Componente tem uma story de Storybook cobrindo todas as variantes e estados.
- [ ] Contraste verificado: todo par texto/fundo que o componente introduz passa em WCAG AA.
