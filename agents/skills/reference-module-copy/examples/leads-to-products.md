# Example: Copying Leads Module to Products Module

This example demonstrates the complete process of copying the Leads module structure to create a Products module.

## Reference Module: Leads

**Location:** `src/app/leads/`

**Files:**
- `src/app/leads/page.tsx` - List page
- `src/app/leads/new/page.tsx` - Create page
- `src/app/leads/[id]/edit/page.tsx` - Edit page
- `src/components/leads/lead-list.tsx` - List component
- `src/components/leads/lead-form.tsx` - Form component
- `src/lib/actions/leads.ts` - Server Actions

---

## Step 1: Read Reference Files

Read all 6 files from the Leads module to understand the structure.

---

## Step 2: Apply Naming Replacements

### Entity Names
- `Lead` → `Product`
- `lead` → `product`
- `leads` → `products`

### File Names
- `lead-list.tsx` → `product-list.tsx`
- `lead-form.tsx` → `product-form.tsx`
- `leads.ts` → `products.ts`

### Component Names
- `LeadList` → `ProductList`
- `LeadForm` → `ProductForm`
- `LeadListProps` → `ProductListProps`

### Function Names
- `getLeadsAction` → `getProductsAction`
- `getLeadByIdAction` → `getProductByIdAction`
- `createLeadAction` → `createProductAction`
- `updateLeadAction` → `updateProductAction`
- `deleteLeadAction` → `deleteProductAction`

### Schema Names
- `CreateLeadSchema` → `CreateProductSchema`
- `UpdateLeadSchema` → `UpdateProductSchema`

---

## Step 3: Copy Files with Replacements

### Example: Server Actions

**Reference:** `src/lib/actions/leads.ts`

```typescript
'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

// Zod Schema
const CreateLeadSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
  company: z.string().optional(),
});

// Server Action
export async function createLeadAction(formData: FormData) {
  try {
    const validatedData = CreateLeadSchema.parse({
      name: formData.get('name'),
      email: formData.get('email'),
      company: formData.get('company'),
    });

    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Unauthorized' };
    }

    const { data, error } = await supabase
      .from('leads')
      .insert({ ...validatedData, user_id: user.id })
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/dashboard/leads');
    return { success: true, data };
  } catch (error) {
    console.error('[createLeadAction] Error:', error);
    return { success: false, error: 'Failed to create lead' };
  }
}
```

**New:** `src/lib/actions/products.ts`

```typescript
'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

// Zod Schema
const CreateProductSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  price: z.number().min(0, 'Price must be positive'),
  description: z.string().optional(),
});

// Server Action
export async function createProductAction(formData: FormData) {
  try {
    const validatedData = CreateProductSchema.parse({
      name: formData.get('name'),
      price: Number(formData.get('price')),
      description: formData.get('description'),
    });

    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Unauthorized' };
    }

    const { data, error } = await supabase
      .from('products')
      .insert({ ...validatedData, user_id: user.id })
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/dashboard/products');
    return { success: true, data };
  } catch (error) {
    console.error('[createProductAction] Error:', error);
    return { success: false, error: 'Failed to create product' };
  }
}
```

**What changed:**
- ✅ Schema name: `CreateLeadSchema` → `CreateProductSchema`
- ✅ Function name: `createLeadAction` → `createProductAction`
- ✅ Table name: `'leads'` → `'products'`
- ✅ Revalidate path: `'/dashboard/leads'` → `'/dashboard/products'`
- ✅ Error message: `'create lead'` → `'create product'`
- ✅ Schema fields: `email, company` → `price, description` (different schema)

**What stayed the same:**
- ✅ Import statements (exact same)
- ✅ Function structure (try/catch, validation, auth, insert, revalidate)
- ✅ Error handling pattern (exact same)
- ✅ Response structure (exact same)
- ✅ Comments (preserved)

---

## Step 4: Verify

### Checklist
- [x] All 6 files copied
- [x] File names follow pattern (product-list.tsx, product-form.tsx)
- [x] Component names follow pattern (ProductList, ProductForm)
- [x] Function names follow pattern (getProductsAction, createProductAction)
- [x] Variable names follow pattern (product, products)
- [x] Import statements preserved
- [x] Component structure identical
- [x] Error handling identical
- [x] Validation patterns identical

---

## Result

The Products module is now an exact copy of the Leads module, with only entity names and schema fields changed. All patterns, structure, and conventions are preserved.
