---
name: Error Handling Patterns
description: Standardized error handling patterns for Server Actions and API integrations, including ActionResponse type and try/catch best practices.
---

# Error Handling Patterns

## 🎯 Purpose

This skill provides standardized error handling patterns for Server Actions and API integrations, ensuring consistent error responses and proper error logging across the application.

## 📋 When to Use This Skill

Use this skill when:
- Creating Server Actions
- Implementing API integrations
- Handling external API calls
- Need consistent error response format

## 🔄 ActionResponse Pattern

A definição canônica de `ActionResponse<T>` (incluindo `PaginationMeta`) está em [`docs/conventions/standards.md`](../../../docs/conventions/standards.md) — fonte única. Os exemplos abaixo usam o tipo conforme definido lá.

---

## 🎯 Server Action Error Handling Template

### Complete Pattern

```typescript
'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

// 1. Define Zod Schema
const CreateEntitySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  // ... other fields
});

// 2. ActionResponse<T> — definido em docs/conventions/standards.md

// 3. Implement Server Action
export async function createEntityAction(
  formData: FormData
): Promise<ActionResponse<{ id: string }>> {
  try {
    // Step 1: Validate input
    const validatedData = CreateEntitySchema.parse({
      name: formData.get('name'),
      // ... other fields
    });

    // Step 2: Check authentication
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Unauthorized' };
    }

    // Step 3: Business logic
    const { data, error } = await supabase
      .from('entities')
      .insert({ ...validatedData, user_id: user.id })
      .select()
      .single();

    if (error) {
      console.error('[createEntityAction] Database error:', error);
      return { success: false, error: error.message };
    }

    // Step 4: Return success
    return { success: true, data };

  } catch (error) {
    // Catch validation errors and unexpected errors
    console.error('[createEntityAction] Error:', error);
    
    if (error instanceof z.ZodError) {
      return { 
        success: false, 
        error: error.errors[0].message 
      };
    }
    
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}
```

---

## 🚨 Error Handling Rules

### ✅ DO:
1. **Always use try/catch** for Server Actions
2. **Log errors to console** with action name prefix
3. **Return ActionResponse** with success/error
4. **Check authentication** before business logic
5. **Validate input** with Zod schemas
6. **Handle Zod errors** separately from other errors
7. **Use descriptive error messages** for users

### ❌ DON'T:
1. **Never expose internal errors** to users
2. **Never use generic error messages** ("Error occurred")
3. **Never throw errors** from Server Actions (return error instead)
4. **Never skip logging** errors
5. **Never use `any` type** for errors

---

## 📚 Common Error Scenarios

### Scenario 1: Validation Error

```typescript
try {
  const validatedData = Schema.parse(rawData);
} catch (error) {
  if (error instanceof z.ZodError) {
    return { 
      success: false, 
      error: error.errors[0].message  // User-friendly message
    };
  }
}
```

### Scenario 2: Authentication Error

```typescript
const { data: { user }, error: authError } = await supabase.auth.getUser();

if (authError || !user) {
  return { success: false, error: 'Unauthorized' };
}
```

### Scenario 3: Database Error

```typescript
const { data, error } = await supabase
  .from('table')
  .insert(data)
  .select()
  .single();

if (error) {
  console.error('[actionName] Database error:', error);
  return { success: false, error: error.message };
}
```

### Scenario 4: Business Logic Error

```typescript
// Check for duplicates
const { data: existing } = await supabase
  .from('table')
  .select()
  .eq('email', email)
  .single();

if (existing) {
  return { success: false, error: 'Email already exists' };
}
```

### Scenario 5: External API Error

```typescript
try {
  const response = await fetch('https://api.example.com/data');
  
  if (!response.ok) {
    console.error('[actionName] API error:', response.statusText);
    return { 
      success: false, 
      error: 'Failed to fetch data from external service' 
    };
  }
  
  const data = await response.json();
  return { success: true, data };
  
} catch (error) {
  console.error('[actionName] Network error:', error);
  return { 
    success: false, 
    error: 'Network error. Please try again.' 
  };
}
```

---

## 🎯 Client-Side Error Handling

### Using ActionResponse in Components

```typescript
'use client';

import { createEntityAction } from '@/lib/actions/entities';
import { toast } from 'sonner';

export function EntityForm() {
  async function handleSubmit(formData: FormData) {
    const result = await createEntityAction(formData);
    
    if (result.success) {
      toast.success('Entity created successfully');
      // Handle success (redirect, refresh, etc.)
    } else {
      toast.error(result.error || 'Failed to create entity');
      // Handle error (show message, etc.)
    }
  }

  return (
    <form action={handleSubmit}>
      {/* Form fields */}
    </form>
  );
}
```

---

## 📝 Logging Best Practices

### Log Format

```typescript
console.error('[actionName] Error type:', error);
```

**Examples:**
```typescript
console.error('[create[Entity]Action] Validation error:', error);
console.error('[update[Entity]Action] Database error:', error);
console.error('[delete[Entity]Action] Authorization error:', error);
```

### What to Log

✅ **DO log:**
- Action name (in brackets)
- Error type (validation, database, auth, network)
- Full error object (for debugging)

❌ **DON'T log:**
- Sensitive data (passwords, tokens)
- User personal information
- Internal system details

---

## 🔗 Related

- **Agents using this skill:** Backend, Tech Lead
- **Related workflows:** None
- **Related skills:** None
