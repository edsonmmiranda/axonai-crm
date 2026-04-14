# Design System — pointer

> **This file is intentionally short.** The design system lives at [`design_system/`](../design_system/) at the project root, not here.

The old version of this document inlined hex literals, ShadcnUI tokens and ad-hoc component snippets. It has been superseded by a proper token pipeline with primitives, semantic layer, generated outputs, build validation and enforcement rules.

If you landed here looking for colors, spacing, components or theming rules, go to the folder below.

---

## Where to look

| You need | Read |
|---|---|
| The big-picture architecture (three layers, why they exist) | [`design_system/README.md`](../design_system/README.md) |
| Raw values: colors, spacing, radius, shadow, type, motion | [`design_system/tokens/primitives.json`](../design_system/tokens/primitives.json) |
| Role-based names (surface, text, action, feedback) | [`design_system/tokens/semantic.light.json`](../design_system/tokens/semantic.light.json), [`semantic.dark.json`](../design_system/tokens/semantic.dark.json) |
| The CSS variables and Tailwind tokens that code consumes | [`design_system/generated/`](../design_system/generated/) |
| How to author a component (Radix + cva + semantic tokens) | [`design_system/components/CONTRACT.md`](../design_system/components/CONTRACT.md) |
| What is enforced at lint/build/CI time | [`design_system/enforcement/rules.md`](../design_system/enforcement/rules.md) |
| Light/dark, multi-brand, per-tenant accent | [`design_system/docs/theming.md`](../design_system/docs/theming.md) |
| Things that look fine and are not (review checklist) | [`design_system/docs/anti-patterns.md`](../design_system/docs/anti-patterns.md) |

---

## One paragraph for agents in a hurry

Components consume **semantic Tailwind classes only** — `bg-surface-raised`, `text-text-primary`, `bg-action-primary`, `border-field-border-error`. No hex literals anywhere outside `design_system/tokens/primitives.json`. No primitive color classes (`bg-blue-500`) in `src/`. No arbitrary values (`p-[17px]`, `w-[350px]`). Variants go through `cva`. Interactive behavior comes from Radix Primitives. Icons come from Lucide. Focus state uses `shadow-focus`. Dark mode works automatically because `[data-theme="dark"]` remaps semantic tokens — if your component does not react to the toggle, it is consuming a primitive and needs fixing.

The rules above are the letter of the law. The reasoning, exceptions, and full component contract are in [`design_system/components/CONTRACT.md`](../design_system/components/CONTRACT.md). Read it before writing a component.
