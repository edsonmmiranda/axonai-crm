# Convenções de CRUD — Framework-level

Padrões de **UI, paths canônicos e naming** para módulos CRUD. As regras invioláveis de Server Actions, `ActionResponse<T>`, e regras de código vivem em [`standards.md`](standards.md) — fonte única. Este arquivo **não redefine** essas regras.

Se um Reference Module existe em `src/app/`, ele é a fonte autoritativa operacional e já codifica essas regras — este arquivo é backup normativo e guia para o bootstrap.

Quando ainda **não** existe Reference Module real no projeto (bootstrap, primeiro CRUD), use o template canônico em [`docs/templates/reference_module/`](../templates/reference_module/) como fonte. Ele codifica as mesmas regras em forma copiável; o protocolo de cópia está em [`agents/skills/reference-module-copy/SKILL.md`](../../agents/skills/reference-module-copy/SKILL.md) (Case B).

**Leitores:** `@frontend`, `@backend`, `@spec-writer`, Tech Lead.

---

## 📁 Paths canônicos

| Tipo | Local |
|---|---|
| Server Actions | `src/lib/actions/[module].ts` |
| Componentes de módulo | `src/components/[module]/` |
| Componentes de UI (wrappers DS) | `src/components/ui/` |
| Integrações de API externa | `src/lib/integrations/[api-name]/` |
| Validators Zod compartilhados | `src/lib/validators/` |
| Tipos compartilhados | `src/types/` |
| Páginas | `src/app/[module]/` (kebab-case) |

## 📏 Naming

- **Componentes:** PascalCase (`LeadForm.tsx`, `LeadList.tsx`)
- **Funções:** camelCase (`handleSubmit`)
- **Server Actions:** camelCase com sufixo `Action` (`createLeadAction`, `updateLeadAction`)
- **Pages de módulo:** kebab-case (`user-profile/page.tsx`)

---

## 🔴 Regras duras de CRUD (framework-level)

### 1. `layout.tsx` obrigatório por módulo

Todo módulo em `src/app/[module]/` **precisa** ter seu próprio `layout.tsx` que envelopa em `DashboardShell` (ou o shell equivalente do projeto). Sem isso, páginas aparecem sem sidebar/header e ficam inconsistentes.

```tsx
// src/app/[module]/layout.tsx
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { ReactNode } from 'react'

export default function ModuleLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>
}
```

**Ordem de criação recomendada ao scaffoldar um módulo novo:**
1. `layout.tsx` (primeiro, para não esquecer)
2. Migration do banco (via `@db-admin`)
3. Server Actions (via `@backend`)
4. Página de listagem
5. Página de criação
6. Página de edição

### 2. URL é a fonte da verdade em listagens

Estado de paginação, filtros, ordenação e busca **sempre** vive em query params. `useState` para essas coisas é violação — quebra deep link, quebra F5, quebra back button.

```tsx
// ❌ ERRADO
const [page, setPage] = useState(1)
const [filters, setFilters] = useState({})

// ✅ CERTO
const searchParams = useSearchParams()
const page = searchParams.get('page') || '1'
router.push(`/entities?page=${newPage}`)
```

### 3. Server-side pagination obrigatória

Listagens **nunca** carregam todos os registros para paginar no cliente. Use `.range(from, to)` do Supabase e retorne `metadata` com paginação.

```ts
// Server Action
export async function getEntities(params: GetEntitiesParams = {}) {
  const page = params.page || 1
  const limit = params.limit || 10
  const from = (page - 1) * limit
  const to = from + limit - 1

  const { data, count } = await supabase
    .from('entities')
    .select('*', { count: 'exact' })
    .range(from, to)
    .order(params.sort || 'created_at', { ascending: params.order === 'asc' })

  return {
    success: true,
    data,
    metadata: {
      total: count || 0,
      totalPages: Math.ceil((count || 0) / limit),
      currentPage: page,
      itemsPerPage: limit,
    },
  }
}
```

```tsx
// Server Component da página
export default async function EntitiesPage(props: {
  searchParams: Promise<SearchParams>
}) {
  const searchParams = await props.searchParams
  const page = Number(searchParams.page) || 1
  const limit = Number(searchParams.itemsPerPage) || 10

  const { data, metadata } = await getEntities({ page, limit })
  return <EntityList data={data} pagination={metadata} />
}
```

### 4. Toast em **toda** operação com side-effect

Criar, atualizar, excluir, upload de arquivo, erros de validação. Zero `alert()`. Zero operação silenciosa.

```tsx
const { showToast } = useToast()

if (result.success) {
  showToast({ variant: 'success', description: 'Registro criado' })
  router.push('/entities')
} else {
  showToast({ variant: 'error', description: result.error || 'Erro ao criar' })
}
```

Variantes: `success` | `error` | `warning` | `info`.

### 5. Danger Zone obrigatória em páginas de edição

Exclusão **nunca** é um botão solto. Sempre:

- Seção visual destacada (separada do form principal)
- `DeleteConfirmationDialog` com digitação literal da palavra "excluir" (ou equivalente)
- Toast de sucesso após a exclusão
- Redirect para a listagem após sucesso

### 6. Validação client-side antes do submit

- Função `validateForm()` roda antes de chamar a action
- Erros são limpos ao digitar (`updateField` reseta o erro do campo tocado)
- Erros aparecem inline no campo, não só no toast
- A Server Action ainda valida com Zod — client-side é UX, server-side é segurança

### 7. Sem `router.refresh()`

Server Components + `revalidatePath()` já cuidam da revalidação. `router.refresh()` é redundante e indica que algo mais está errado.

---

## 🔧 Server Actions — contrato de retorno

O contrato `ActionResponse<T>`, as 10 regras invioláveis de Server Actions, e os padrões de erro estão centralizados em [`standards.md`](standards.md). Templates de implementação em [`docs/templates/server_actions.md`](../templates/server_actions.md) e [`agents/skills/error-handling/SKILL.md`](../../agents/skills/error-handling/SKILL.md).

---

## ⚡ Performance (regras mínimas)

- Use `.select('campos_necessarios')`, não `.select('*')` — ainda mais em listagens
- Debounce em buscas (300ms)
- `useTransition` para feedback visual em actions não-instantâneas
- Indexe colunas ordenáveis no banco (delegue ao `@db-admin` no spec)

---
