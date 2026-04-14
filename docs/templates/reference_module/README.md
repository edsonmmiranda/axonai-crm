# Reference Module — Canonical Template

Minimal, production-shaped CRUD module. Used as **fallback source** by the `reference-module-copy` skill when no real module exists yet in `src/app/` (bootstrap phase).

Entity used in this template: **`item`** / **`items`** (generic placeholder).

---

## 📁 File map

When copying, rename `item` → your entity everywhere (e.g., `lead`, `product`, `task`).

| Template file | Copies to | Purpose |
|---|---|---|
| `migration.sql` | `supabase/migrations/<ts>_create_items.sql` | Table + RLS |
| `schemas.ts` | `src/lib/validators/item.ts` | Zod schemas + TS types |
| `actions.ts` | `src/lib/actions/item.ts` | Server Actions (CRUD) |
| `layout.tsx` | `src/app/items/layout.tsx` | DashboardShell wrapper |
| `page.tsx` | `src/app/items/page.tsx` | List page (server component) |
| `new-page.tsx` | `src/app/items/new/page.tsx` | Create page |
| `edit-page.tsx` | `src/app/items/[id]/edit/page.tsx` | Edit page |
| `item-list.tsx` | `src/components/items/item-list.tsx` | List client component |
| `item-form.tsx` | `src/components/items/item-form.tsx` | Form client component |

---

## 🔤 Naming replacements

Run these renames everywhere in copied files:

| From | To (example: entity = `lead`) |
|---|---|
| `item` | `lead` |
| `items` | `leads` |
| `Item` | `Lead` |
| `Items` | `Leads` |
| `ItemSchema` / `ItemInputSchema` | `LeadSchema` / `LeadInputSchema` |
| `createItemAction` / `updateItemAction` / `deleteItemAction` / `getItemsAction` / `getItemByIdAction` | `createLeadAction` / ... |

---

## ✅ What this template guarantees

- **`ActionResponse<T>` everywhere** — Zod validation, auth check, try/catch, revalidatePath.
- **Semantic tokens only** — no hex literals, no primitive color classes, no arbitrary Tailwind values.
- **`src/components/ui/`** wrappers — never inline primitives.
- **URL as source of truth** — pagination/filters live in query params.
- **Server-side pagination** — `.range()` + `{ count: 'exact' }`.
- **Toast on every side-effect** — success and error branches.
- **DeleteConfirmationDialog** with literal-word typing.
- **Dark mode from commit 1** — no `// TODO: dark mode`.

---

## 🚫 What this template intentionally omits

- Business logic — this is a structural template, not a feature spec.
- Custom visuals — semantic defaults only, intentionally plain.
- Tests — project has no mandatory test suite (see stack.md).

---

## 🔄 When this template becomes stale

As soon as the first real module is built in `src/app/`, that module **replaces** this template as the skill's source. Update the skill's fallback note when that happens.
