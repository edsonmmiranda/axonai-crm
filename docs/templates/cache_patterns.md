# Cache & Performance Patterns — Next.js 15 Nativo

Padrões de cache e otimização usados por [`@performance-engineer`](../../agents/on-demand/performance-engineer.md). Este framework **não usa React Query nem Redis** — todo cache é via primitivas nativas do Next.js 15 + cache do Supabase.

---

## Camadas de cache (Next.js 15)

| Camada | O que é | Quando usar |
|---|---|---|
| **Browser / CDN** | Assets estáticos servidos automaticamente pelo Next. | Automático. Nada a configurar. |
| **Full Route Cache** | Server Components renderizados em build time. | Páginas marketing, listagens raramente mutáveis. |
| **Data Cache** (`fetch`) | `fetch(url, { next: { revalidate, tags } })`. | APIs externas, dados compartilhados entre rotas. |
| **`unstable_cache`** | Wrapper tipado para funções arbitrárias. | Queries Supabase repetidas, agregados caros. |
| **`revalidatePath` / `revalidateTag`** | Invalidação sob demanda após mutações. | Todo Server Action mutante. |
| **Materialized views** | Agregados pré-computados no Postgres. | Dashboards e KPIs caros. |

> Este projeto **não** usa React Query nem Redis. Caching é inteiramente via primitivas nativas do Next.js 15 + cache do Supabase. Não introduza React Query ou Redis sem aprovação explícita — são mudanças arquiteturais, não otimizações de performance.

---

## Pattern 1: `unstable_cache` para agregados

```typescript
import { unstable_cache } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export const getCachedStats = unstable_cache(
  async (userId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from('lead_stats_view')
      .select('*')
      .eq('user_id', userId)
      .single();
    return data;
  },
  ['lead-stats'],
  { tags: ['lead-stats'], revalidate: 60 }
);
```

Invalide após mutação:

```typescript
import { revalidateTag } from 'next/cache';
revalidateTag('lead-stats');
```

---

## Pattern 2: Fetch com tag + revalidate

```typescript
const res = await fetch(url, {
  next: { revalidate: 60, tags: ['leads'] },
});
```

```typescript
import { revalidatePath, revalidateTag } from 'next/cache';
revalidatePath('/dashboard/leads');
revalidateTag('leads');
```

---

## Pattern 3: Queries paralelas em Server Component

```typescript
const [leads, stats, activities] = await Promise.all([
  getLeads(),
  getStats(),
  getActivities(),
]);
```

---

## Pattern 4: Seleção restrita de colunas + paginação

```typescript
const { data: leads } = await supabase
  .from('leads')
  .select('id, name, email, status')  // só o que a UI renderiza
  .range(0, 49)
  .order('created_at', { ascending: false });
```

---

## Pattern 5: Otimização de frontend (code splitting, memo, virtualização)

```typescript
// Code splitting
const HeavyComponent = dynamic(() => import('./Heavy'), {
  loading: () => <Skeleton />,
  ssr: false,
});

// Memoization de row de lista
const LeadItem = memo(({ lead }) => <div>{lead.name}</div>);

// Virtual scrolling (listas grandes)
import { useVirtualizer } from '@tanstack/react-virtual';

// Imagens
<Image
  src="/hero.jpg"
  width={800}
  height={600}
  loading="lazy"
  placeholder="blur"
/>
```

---

## Pattern 6: Otimização de banco (índices estratégicos)

```sql
-- Índice composto status + created_at (padrão de listagem filtrada)
CREATE INDEX idx_leads_status_created
  ON leads(status, created_at DESC);

-- Índice parcial (só para filtro mais comum)
CREATE INDEX idx_active_leads
  ON leads(created_at)
  WHERE status = 'active';
```

---

## Queries de diagnóstico (Postgres)

```sql
-- Queries lentas
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Candidatos a índice (alta cardinalidade, baixa correlação)
SELECT schemaname, tablename, attname
FROM pg_stats
WHERE n_distinct > 100
  AND correlation < 0.1;
```

---

## Quando cachear e quando NÃO cachear

| Cachear | NÃO cachear |
|---|---|
| Dados frequentemente acessados | Dados específicos de usuário sem isolamento |
| Computações caras | Dados em tempo real |
| Respostas de API externa | Informações sensíveis |
| Conteúdo estático | Dados que mudam a cada request |

---

## Referências

- Agente: [`agents/on-demand/performance-engineer.md`](../../agents/on-demand/performance-engineer.md)
