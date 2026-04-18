---
name: Reference Module Copy Protocol
description: Protocol for copying exact structure from a reference module to a new module, preserving all patterns and only changing entity names.
---

# Reference Module Copy Protocol

## 🎯 Purpose

This skill provides a systematic protocol for copying the exact structure, patterns, and conventions from a reference module to a new module. It ensures perfect fidelity by preserving all code patterns and only changing entity names.

## 📋 When to Use This Skill

Use this skill when:
- PRD mentions "Reference Module Compliance" section
- Sprint file contains "Reference Module Patterns" section
- User explicitly requests to copy structure from an existing module
- Creating a new CRUD module that should match an existing one

## 🔄 Protocol Steps

### Step 0: Identify the reference source

Two cases:

**Case A — A real module exists in `src/app/`** (preferred once the project has at least one CRUD). The real module is authoritative: it already reflects the current design system, conventions, and any project-specific adjustments.

**Case B — No real module exists yet** (bootstrap phase, first CRUD of a new project). Fall back to the **canonical template** at [`docs/templates/reference_module/`](../../../docs/templates/reference_module/). It is a framework-level CRUD skeleton that encodes every invariant (`ActionResponse<T>`, semantic tokens, URL-driven pagination, DeleteConfirmationDialog, Danger Zone, dark mode). Read `docs/templates/reference_module/README.md` first for the file map and rename table.

**Rule:** prefer Case A whenever available — the template is the *seed*, not the *truth*. As soon as one real module exists in `src/app/`, it replaces the template as the source for subsequent modules.

---

### Step 1: Read Reference Module Files

**Case A (real module):** Read ALL files listed in PRD's "Files to Copy" section:

```
0. Read `src/app/[reference]/layout.tsx`              ← layout do módulo (DashboardShell)
1. Read `src/app/[reference]/page.tsx`
2. Read `src/app/[reference]/new/page.tsx`
3. Read `src/app/[reference]/[id]/edit/page.tsx`
4. Read `src/components/[reference]/[entity]-list.tsx`
5. Read `src/components/[reference]/[entity]-form.tsx`
6. Read `src/lib/actions/[reference].ts`
```

**Case B (template fallback):** Read every file under `docs/templates/reference_module/` following the README map.

**IMPORTANT:** Read the ACTUAL files, not just documentation.

---

### Step 2: Copy Exact Structure

For EACH file:

1. **Copy entire file content** (all lines)
2. **Replace entity names** according to PRD's "Naming Pattern Replacements"
3. **Preserve ALL patterns:**
   - Import statements (order and structure)
   - Component structure (hooks, state, effects)
   - Props interfaces (all properties)
   - State management (useState, useEffect patterns)
   - Event handlers (function signatures)
   - Styling classes (exact Tailwind classes)
   - Comments and documentation
   - Error handling patterns
   - Validation logic
4. **Only change:**
   - Entity names (Lead → Product)
   - Table names ('leads' → 'products')
   - Field names (if different schema)

---

### Step 3: Verify Naming Replacements

Follow PRD's exact naming pattern:

#### File Names
```
[reference-entity].tsx → [new-entity].tsx

Example:
lead-list.tsx → product-list.tsx
lead-form.tsx → product-form.tsx
```

#### Component Names
```
ReferenceEntity → NewEntity

Example:
LeadList → ProductList
LeadForm → ProductForm
```

#### Props/Types
```
ReferenceEntityProps → NewEntityProps

Example:
LeadListProps → ProductListProps
interface Lead → interface Product
```

#### Function Names
```
getReferenceEntitiesAction → getNewEntitiesAction

Example:
getLeadsAction → getProductsAction
createLeadAction → createProductAction
```

#### Variables
```
referenceEntity → newEntity

Example:
const lead = ... → const product = ...
const leads = ... → const products = ...
```

---

### Step 4: Preserve Patterns

**DO NOT change:**
- Component structure
- Import order
- Function signatures (except entity names)
- State management patterns
- Event handler patterns
- Styling approach (Tailwind classes)
- Comments and documentation
- Error handling structure
- Validation logic structure
- Response patterns

**Example of what to preserve:**

```typescript
// Reference: src/components/leads/lead-list.tsx
import { useState, useEffect } from 'react';
import { LeadListProps } from './types';
import { Button } from '@/components/ui/button';

export function LeadList({ leads, onEdit }: LeadListProps) {
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  
  useEffect(() => {
    // Some effect logic
  }, [leads]);
  
  return (
    <div className="space-y-4">
      {/* Component JSX */}
    </div>
  );
}

// New: src/components/products/product-list.tsx
import { useState, useEffect } from 'react';  // ✅ SAME import
import { ProductListProps } from './types';    // ✅ Name changed
import { Button } from '@/components/ui/button'; // ✅ SAME import

export function ProductList({ products, onEdit }: ProductListProps) { // ✅ Name changed
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null); // ✅ Name changed
  
  useEffect(() => {
    // Some effect logic  // ✅ SAME logic
  }, [products]);  // ✅ Dependency changed
  
  return (
    <div className="space-y-4">  // ✅ SAME styling
      {/* Component JSX */}
    </div>
  );
}
```

---

## ✅ Verification Checklist

After copying, verify:

- [ ] Module `layout.tsx` exists and imports `DashboardShell`
- [ ] All files from reference module have been copied
- [ ] File names follow naming pattern (kebab-case)
- [ ] Component names follow naming pattern (PascalCase)
- [ ] Function names follow naming pattern (camelCase + "Action")
- [ ] Variable names follow naming pattern (camelCase)
- [ ] Import statements are preserved
- [ ] Component structure is identical
- [ ] Styling classes are identical
- [ ] Comments are preserved
- [ ] Error handling is identical
- [ ] Validation patterns are identical

---

## 🚨 Common Mistakes to Avoid

### ❌ WRONG: Changing structure
```typescript
// Reference has useEffect
useEffect(() => { ... }, [deps]);

// New module removes it
// ❌ BAD: Structure changed!
```

### ❌ WRONG: Changing styling
```typescript
// Reference uses specific Tailwind classes
<div className="flex items-center gap-4">

// New module changes classes
<div className="flex flex-row space-x-4">
// ❌ BAD: Styling changed!
```

### ❌ WRONG: Changing imports
```typescript
// Reference imports from specific path
import { Button } from '@/components/ui/button';

// New module changes import
import Button from '@/components/ui/button';
// ❌ BAD: Import style changed!
```

### ✅ CORRECT: Only change entity names
```typescript
// Reference
const lead = await getLeadByIdAction(id);

// New module
const product = await getProductByIdAction(id);
// ✅ GOOD: Only entity name changed!
```

---

## 📚 Examples

See `examples/` directory for complete examples:
- `leads-to-products.md` - Full example of copying Leads module to Products
- `naming-patterns.md` - Comprehensive naming convention examples

---

## 🔗 Related

- **Agents using this skill:** Frontend, Backend, Spec Writer
- **Related workflows:** None
- **Related skills:** None
