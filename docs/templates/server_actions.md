# Server Actions — Templates

Padrões canônicos de Server Actions (Next.js 15 + Supabase + Zod 4). O agente [`@backend`](../../agents/stack/backend.md) usa este arquivo como fonte única de verdade para novo código. Cada seção cobre um caso — copie o mais próximo e ajuste.

---

## Contrato de retorno (obrigatório)

Toda Server Action retorna `ActionResponse<T>`:

```typescript
interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
```

Regras:
- `console.error(error)` internamente, `error: 'Mensagem amigável'` no retorno — nunca vaze `error.message` bruto.
- Nunca lance exceções para o cliente; capture em `try/catch` e retorne `{ success: false, error }`.
- Nunca faça `catch {}` silencioso.
- Zod 4 usa `error.issues[0].message` (não `error.errors` — anti-padrão).

---

## Template exemplar — Create (CRUD completo)

```typescript
'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

// 1. Schema Zod para validação
const CreateLeadSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  email: z.string().email('Email inválido'),
  company: z.string().optional(),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Telefone inválido').optional(),
});

type CreateLeadInput = z.infer<typeof CreateLeadSchema>;

interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function createLeadAction(
  formData: FormData
): Promise<ActionResponse<{ id: string }>> {
  try {
    // Passo 1: parse e validação do input
    const rawData = {
      name: formData.get('name'),
      email: formData.get('email'),
      company: formData.get('company'),
      phone: formData.get('phone'),
    };
    const validatedData = CreateLeadSchema.parse(rawData);

    // Passo 2: autenticação
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: 'Não autorizado' };
    }

    // Passo 3: regra de negócio (duplicata)
    const { data: existing } = await supabase
      .from('leads')
      .select('id')
      .eq('email', validatedData.email)
      .eq('user_id', user.id)
      .single();
    if (existing) {
      return { success: false, error: 'Já existe um lead com este email' };
    }

    // Passo 4: insert
    const { data: newLead, error: insertError } = await supabase
      .from('leads')
      .insert({
        ...validatedData,
        user_id: user.id,
        status: 'new',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (insertError) {
      console.error('Database error:', insertError);
      return { success: false, error: 'Falha ao criar lead' };
    }

    // Passo 5: revalidar cache
    revalidatePath('/dashboard/leads');

    return { success: true, data: { id: newLead.id } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0].message };
    }
    console.error('Unexpected error:', error);
    return { success: false, error: 'Ocorreu um erro inesperado' };
  }
}
```

Esse é o padrão canônico. **Read / Update / Delete seguem a mesma forma** — só trocam:

| Variante | Diferenças em relação ao Create |
|---|---|
| **Read (list)** | Sem `formData` (ou com filtros/paginação). Sem insert. RLS filtra por `user_id` automaticamente. Retorna `data: T[]`. |
| **Update** | Schema inclui `id: z.string().uuid()`. Usa `.update({...}).eq('id', id)`. Inclui `updated_at: new Date().toISOString()`. |
| **Delete** | Geralmente aceita `id: string` direto (não `FormData`). Usa `.delete().eq('id', id)`. Em soft delete: `.update({ deleted_at: new Date().toISOString() })`. |

Não duplique o template inteiro para cada operação — copie o Create e trate a diferença.

---

## Padrões Zod recorrentes

```typescript
email: z.string().email('Email inválido')
phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Telefone inválido')
website: z.string().url('URL inválida')
status: z.enum(['active', 'inactive', 'pending'])
theme: z.string().default('light')

// Validação condicional
z.object({
  type: z.enum(['individual', 'company']),
  companyName: z.string().optional(),
}).refine(
  (data) => data.type !== 'company' || data.companyName,
  { message: 'Nome da empresa é obrigatório para tipo company' }
)
```

---

## Revalidação de cache

```typescript
import { revalidatePath, revalidateTag } from 'next/cache';

revalidatePath('/dashboard/leads');          // path específico
revalidatePath('/dashboard', 'layout');      // árvore inteira sob /dashboard
revalidateTag('leads');                      // por tag (se usando fetch com tags)
```

Sempre revalide após mutações (create/update/delete).

---

## Erros comuns a evitar

```typescript
// ❌ Falha silenciosa
try { await operation(); } catch {}

// ❌ Vaza detalhes internos
return { error: error.message };

// ❌ Sem validação
function createLead(data: any) { ... }

// ❌ Lógica de negócio em SQL
const { data } = await supabase.rpc('calculate_complex_business_logic');

// ✅ Explícito, validado, seguro
const schema = z.object({ ... });
const validated = schema.parse(input);
const result = calculateInTypeScript(validated);
```

---

## Referências

- Fonte canônica do padrão de erro: [`agents/skills/error-handling/SKILL.md`](../../agents/skills/error-handling/SKILL.md)
- Persona do agente: [`agents/stack/backend.md`](../../agents/stack/backend.md)
- Clonagem de módulo existente: [`agents/skills/reference-module-copy/SKILL.md`](../../agents/skills/reference-module-copy/SKILL.md)
