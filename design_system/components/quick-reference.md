# Quick Reference — Design System para Agentes

> **Propósito:** este arquivo consolida o essencial de múltiplos arquivos do DS em um único documento. Leia **este arquivo primeiro** antes de criar qualquer tela. Para detalhes profundos de um componente específico, abra o YAML correspondente em `catalog/`.
>
> **Este arquivo não substitui** os YAMLs individuais — ele acelera o bootstrap, reduzindo de ~12 arquivos para 1 na maioria dos casos.

---

## 1. Modelo mental: como montar uma página

```
Recipe (tipo de página)
  → Template (layout + lista de organismos com paths)
    → Organism YAMLs (code pattern de cada bloco)
      → Molecule/Atom YAMLs (code pattern de cada peça)
```

**Atalho:** para listing, form e kanban, já existem **exemplos completos montados** em `recipes/examples/`. Leia o exemplo antes de começar — ele mostra todos os organismos compostos em uma única página TSX.

---

## 2. Recipes disponíveis + exemplos

| Tipo de página | Recipe | Exemplo completo |
|---|---|---|
| CRUD listing | [`recipes/crud-completo.yaml`](recipes/crud-completo.yaml) | [`recipes/examples/listing-page.tsx.example`](recipes/examples/listing-page.tsx.example) |
| Formulário de criação | [`recipes/crud-completo.yaml`](recipes/crud-completo.yaml) (step 2) | [`recipes/examples/form-create-page.tsx.example`](recipes/examples/form-create-page.tsx.example) |
| Formulário de edição | [`recipes/crud-completo.yaml`](recipes/crud-completo.yaml) (step 3) | [`recipes/examples/form-edit-page.tsx.example`](recipes/examples/form-edit-page.tsx.example) |
| Página de impressão | [`recipes/pagina-relatorio.yaml`](recipes/pagina-relatorio.yaml) | [`recipes/examples/print-page.tsx.example`](recipes/examples/print-page.tsx.example) |
| Kanban / Pipeline | [`recipes/kanban-pipeline.yaml`](recipes/kanban-pipeline.yaml) | [`recipes/examples/kanban-page.tsx.example`](recipes/examples/kanban-page.tsx.example) |
| Dashboard | [`recipes/dashboard.yaml`](recipes/dashboard.yaml) | [`recipes/examples/dashboard-page.tsx.example`](recipes/examples/dashboard-page.tsx.example) |

---

## 3. Templates — layout + organismos (com paths)

### Listing Page
```
Sidebar + Main(App Header + Page Header Listing + Stat Cards Grid + Filter Bar + Sort Control + Data Table + Pagination)
Container: flex h-screen bg-surface-base → content max-w-7xl mr-auto flex flex-col gap-6
```

### Form Create
```
Sidebar + Main(App Header + Breadcrumb + Page Header Form + Form Card Section × N + Form Action Bar)
Container: flex h-screen bg-surface-base → content max-w-4xl mr-auto flex flex-col gap-6 pb-10
```

### Form Edit
```
Mesmo do Create + Badge status + Edit Page Metadata + Activity Timeline + Action Bar split (delete left)
```

### Print Page
```
Screen Toolbar (.no-print) + Print Report Header + Data Table (compact) + Print Summary Footer
Container: sem sidebar, max-w-print mr-auto
```

### Kanban Board
```
Sidebar + Pipeline Header + Board(Kanban Column × N(Kanban Card × N))
Container: flex h-screen → board flex-1 overflow-x-auto p-6 → inner flex h-full gap-5 min-w-max
```

### Dashboard
```
Sidebar + Main(App Header + Scrollable Content(
  Dashboard Greeting + Stat Cards Grid
  + Grid 2/3 + 1/3(
      Left: Data Table (leads recentes) + Grid(Gradient CTA Card + Goal Progress Card)
      Right: Pipeline Summary Card + Task List
    )
))
Container: flex h-screen bg-surface-base → content max-w-[1400px] mr-auto flex flex-col gap-6 pb-10
```

---

## 4. Code patterns dos organismos mais usados

### Sidebar
```tsx
<aside className="hidden md:flex flex-col w-64 h-full border-r border-border bg-surface-raised flex-shrink-0 z-30 shadow-sm">
  <div className="p-6 pb-2">{/* Logo Block */}</div>
  <nav className="flex-1 flex flex-col gap-2 px-4 py-6 overflow-y-auto">
    {/* NavItem: ativo = bg-action-primary text-action-primary-fg */}
    {/* NavItem: inativo = text-text-secondary hover:bg-surface-sunken */}
  </nav>
  <div className="p-4 border-t border-border">{/* Logout */}</div>
</aside>
```

### App Header
```tsx
<header className="h-16 flex items-center justify-between px-6 border-b border-border bg-surface-raised/80 backdrop-blur-md sticky top-0 z-20">
  <div className="flex-1 max-w-md hidden sm:flex">{/* Search Field */}</div>
  <div className="flex items-center gap-4 ml-4">{/* Notifications, Settings, User */}</div>
</header>
```

### Page Header — Listing
```tsx
<div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
  <div className="flex flex-col gap-2">
    <h2 className="text-3xl font-bold tracking-tight text-text-primary">{title}</h2>
    <p className="text-text-secondary max-w-2xl">{description}</p>
  </div>
  <div className="flex items-center gap-3">{/* Buttons */}</div>
</div>
```

### Filter Bar
```tsx
<div className="flex flex-col gap-4 rounded-xl border border-border bg-surface-raised p-4 shadow-sm xl:flex-row xl:items-center">
  {/* Search */}
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-row">{/* Selects + Filtros btn */}</div>
</div>
```

### Data Table
```tsx
<div className="bg-surface-raised rounded-xl border border-border shadow-sm overflow-hidden">
  <table className="min-w-full text-sm text-left">
    <thead className="text-xs text-text-secondary uppercase bg-surface-sunken border-b border-border-subtle">
      {/* th: py-3.5 pl-6 pr-3 font-semibold tracking-wide */}
    </thead>
    <tbody className="divide-y divide-border-subtle">
      {/* tr: hover:bg-surface-sunken/80 */}
    </tbody>
  </table>
</div>
```

### Form Card Section
```tsx
<div className="rounded-xl border border-border bg-surface-raised p-6 shadow-sm md:p-8">
  {/* Header: icon bg (feedback-{intent}-bg) + title + description */}
  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
    {/* Form Fields */}
  </div>
</div>
```

### Form Field
```tsx
<div className="flex flex-col gap-1.5">
  <label className="text-sm font-medium text-text-primary">
    {label} {required && <span className="text-action-danger ml-0.5">*</span>}
  </label>
  <Input aria-invalid={!!error} />
  {error && <p className="text-xs text-feedback-danger-fg">{error}</p>}
</div>
```

### Breadcrumb
```tsx
<nav className="flex items-center gap-2 text-sm text-text-secondary">
  <a className="hover:text-action-ghost-fg transition-colors">Home</a>
  <ChevronRight className="size-4 text-text-muted" />
  <span className="text-text-primary font-semibold">Página Atual</span>
</nav>
```

### Dashboard Greeting
```tsx
<div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
  <div>
    <h2 className="text-3xl font-bold text-text-primary tracking-tight">{greeting}, {userName}!</h2>
    <p className="text-text-secondary mt-1">
      Aqui está o resumo das suas atividades de hoje,{" "}
      <span className="text-action-ghost-fg font-medium">{formattedDate}</span>.
    </p>
  </div>
  <div className="flex gap-2">{/* Quick Action Buttons */}</div>
</div>
```

### Quick Action Button
```tsx
<button className="flex flex-col items-center justify-center size-[72px] rounded-xl bg-surface-raised hover:bg-action-primary/5 border border-border hover:border-action-primary/50 transition-all group gap-1 shadow-sm hover:shadow-md">
  <Icon className="size-5 text-action-primary group-hover:scale-110 transition-transform" />
  <span className="text-[10px] font-medium text-text-secondary group-hover:text-action-ghost-fg">{label}</span>
</button>
```

### Progress Bar
```tsx
<div className="w-full bg-surface-sunken rounded-full h-2.5">
  <div className="bg-action-primary h-2.5 rounded-full" style={{ width: `${percent}%` }} />
</div>
```

### Pipeline Summary Card
```tsx
<div className="bg-surface-raised rounded-xl border border-border p-5 shadow-sm">
  <h3 className="text-lg font-bold text-text-primary mb-4">{title}</h3>
  <div className="flex flex-col gap-4">
    {/* Pipeline Stage Bar × N */}
    <div className="group">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-text-secondary group-hover:text-action-ghost-fg transition-colors">{stageName}</span>
        <span className="text-text-primary font-medium">{count}</span>
      </div>
      <div className="w-full bg-surface-sunken rounded-full h-2">
        <div className={cn("h-2 rounded-full", stageColorClass)} style={{ width: `${percent}%` }} />
      </div>
    </div>
  </div>
</div>
```

### Task List
```tsx
<div className="bg-surface-raised rounded-xl border border-border flex flex-col flex-1 shadow-sm">
  <div className="p-5 border-b border-border-subtle flex justify-between items-center bg-surface-sunken/50">
    <h3 className="text-lg font-bold text-text-primary">{title}</h3>
    <button className="text-action-ghost-fg hover:bg-action-primary/10 rounded p-1 transition-colors">
      <Plus className="size-5" />
    </button>
  </div>
  <div className="flex flex-col divide-y divide-border-subtle">
    {/* Task Item × N */}
    <div className="p-4 hover:bg-surface-sunken transition-colors cursor-pointer flex gap-3 items-start">
      <div className={cn("mt-1 size-2 rounded-full shadow-sm", priorityColorClass)} />
      <div className="flex-1">
        <p className="text-sm font-medium text-text-primary line-clamp-1">{title}</p>
        <p className="text-xs text-text-secondary mt-0.5 flex items-center gap-1">
          <Clock className="size-3" /> {time}
        </p>
      </div>
    </div>
  </div>
  <div className="p-4 mt-auto border-t border-border-subtle">
    <button className="w-full py-2 rounded-lg border border-border text-text-secondary text-sm font-medium hover:bg-surface-sunken hover:text-text-primary transition-colors">
      {footerLabel}
    </button>
  </div>
</div>
```

### Gradient CTA Card
```tsx
<div className="bg-gradient-to-br from-action-primary-hover to-action-primary-active rounded-xl p-6 relative overflow-hidden text-text-inverse flex flex-col justify-between min-h-[160px] shadow-lg">
  <div className="absolute right-0 top-0 size-32 bg-surface-raised/10 rounded-full blur-3xl -mr-10 -mt-10" />
  <div>
    <div className="flex items-center gap-2 mb-2">
      <Icon className="size-5" />
      <span className="text-sm font-bold uppercase tracking-wide opacity-90">{tagline}</span>
    </div>
    <h4 className="text-xl font-bold max-w-[90%]">{title}</h4>
  </div>
  <div className="flex items-center justify-between mt-4">
    {/* Avatar Group */}
    <button className="bg-surface-raised text-action-primary px-4 py-2 rounded-lg text-sm font-bold shadow-lg hover:bg-surface-sunken transition-colors">{actionLabel}</button>
  </div>
</div>
```

### Goal Progress Card
```tsx
<div className="bg-surface-raised border border-border rounded-xl p-6 flex flex-col justify-between shadow-sm">
  <div className="flex justify-between items-start">
    <div>
      <p className="text-text-secondary text-sm font-medium">{label}</p>
      <h4 className="text-2xl font-bold text-text-primary mt-1">{value}</h4>
    </div>
    <div className="p-2 bg-feedback-success-bg rounded-lg">
      <Icon className="size-5 text-feedback-success-fg" />
    </div>
  </div>
  {/* Progress Bar */}
  <p className="text-xs text-text-secondary mt-2">{helperText}</p>
</div>
```

---

## 5. Guia rápido de decisão de tokens

### Fundos (surface)
| Cenário | Classe |
|---|---|
| Fundo da página | `bg-surface-base` |
| Cards, sidebar, header | `bg-surface-raised` |
| Áreas recuadas (thead, inputs) | `bg-surface-sunken` |
| Dialogs, popovers | `bg-surface-overlay` |
| Tooltips | `bg-surface-inverse` |

### Texto
| Cenário | Classe |
|---|---|
| Títulos, corpo, labels | `text-text-primary` |
| Metadata, captions | `text-text-secondary` |
| Placeholders, ícones inativos | `text-text-muted` |
| Sobre fundo escuro | `text-text-inverse` |

### Bordas
| Cenário | Classe |
|---|---|
| Cards, inputs, dividers | `border-border` |
| Hover, separadores fortes | `border-border-strong` |
| Entre rows de tabela | `border-border-subtle` |
| Focus ring | `border-border-focus` |

### Ações (botões)
| Cenário | Variante |
|---|---|
| CTA principal (Salvar, Criar) | `primary` — máx 1 por região visual |
| Alternativas (Cancelar, Filtrar) | `secondary` |
| Terciárias, ícones | `ghost` |
| Destrutivas (Excluir) | `danger` |

### Feedback (badges, alerts)
| Estado | Classes leve | Classes sólido |
|---|---|---|
| Sucesso | `bg-feedback-success-bg text-feedback-success-fg` | `bg-feedback-success-solid-bg text-feedback-success-solid-fg` |
| Alerta | `bg-feedback-warning-bg text-feedback-warning-fg` | `bg-feedback-warning-solid-bg text-feedback-warning-solid-fg` |
| Erro | `bg-feedback-danger-bg text-feedback-danger-fg` | `bg-feedback-danger-solid-bg text-feedback-danger-solid-fg` |
| Info | `bg-feedback-info-bg text-feedback-info-fg` | `bg-feedback-info-solid-bg text-feedback-info-solid-fg` |
| Accent | `bg-feedback-accent-bg text-feedback-accent-fg` | `bg-feedback-accent-solid-bg text-feedback-accent-solid-fg` |

**Leve** = badges, alerts, banners inline. **Sólido** = dots, contadores, indicadores que precisam de atenção imediata.

---

## 6. Stack de componentes

| Camada | Tecnologia |
|---|---|
| Headless | Radix Primitives (ou React Aria) |
| Estilização | Tailwind + tokens semânticos |
| Composição de classes | `cn()` (clsx + tailwind-merge) |
| Variantes | `cva` (class-variance-authority) |
| Ícones | Lucide |
| Formulários | react-hook-form + Zod |

---

## 7. Regras que nunca pode quebrar

1. **Zero literais** — nenhum hex, rgb, hsl no código
2. **Zero valores arbitrários** — nenhum `p-[17px]`, `bg-[#fff]` (exceções documentadas no CONTRACT.md)
3. **Tokens semânticos, não primitivos** — `bg-action-primary`, não `bg-blue-500`
4. **Radix para interação** — dialog, popover, tooltip sempre headless
5. **Variantes via cva** — nunca condicionais ad-hoc
6. **Ícones do Lucide** — sem SVGs customizados nem segunda lib

---

## 8. Quando preciso de mais detalhes

| Preciso de | Leia |
|---|---|
| Code pattern completo de um componente | `catalog/{level}/{component}.yaml` |
| Todas as variantes e props | YAML do componente em `catalog/` |
| Regras detalhadas de authoring | [`CONTRACT.md`](CONTRACT.md) |
| Anti-patterns | [`../docs/anti-patterns.md`](../docs/anti-patterns.md) |
| Tokens semânticos completos (JSON) | [`../tokens/semantic.light.json`](../tokens/semantic.light.json) |
| Exceções de layout | [Seção no CONTRACT.md](CONTRACT.md#exceções-de-layout--valores-arbitrários-permitidos) |
