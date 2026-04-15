# Database Introspection — Helpers e Padrões

Templates de introspecção real de schema usados pelo agente [`@db-admin`](../../agents/ops/db-admin.md). A regra de ouro: **ler o banco real, nunca confiar em arquivos de migração**.

---

## Bootstrap (primeira vez no projeto)

Todo projeto que usa este framework precisa aplicar a migração de bootstrap antes que `@db-admin` possa rodar introspecção:

```
supabase/migrations/00000000000000_framework_bootstrap.sql
```

Ela é idempotente (`CREATE OR REPLACE`) e instala os quatro helpers RPC listados abaixo. Aplique com:

```bash
supabase db push
```

---

## Preflight probe

Antes de qualquer sprint, confirme que os helpers estão presentes:

```typescript
const { error } = await supabase.rpc('get_schema_tables');
if (error?.message?.includes('does not exist')) {
  throw new Error(
    'Framework bootstrap migration not applied. Run `supabase db push` to install the helper RPCs.'
  );
}
```

Se o probe falhar com `function get_schema_tables() does not exist`, pare e peça ao usuário para aplicar a bootstrap antes de continuar.

---

## Helper functions (definição canônica)

Estas funções vivem no arquivo de bootstrap acima. Se precisar editá-las, edite o arquivo de bootstrap — **nunca duplique em migração separada**.

```sql
-- Listar todas as tabelas do schema public
CREATE OR REPLACE FUNCTION get_schema_tables()
RETURNS TABLE (table_name text, table_type text)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    t.table_name::text,
    t.table_type::text
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
  ORDER BY t.table_name;
$$;

-- Colunas de uma tabela
CREATE OR REPLACE FUNCTION get_table_columns(p_table_name text)
RETURNS TABLE (
  column_name text,
  data_type text,
  is_nullable text,
  column_default text,
  character_maximum_length integer
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    c.column_name::text,
    c.data_type::text,
    c.is_nullable::text,
    c.column_default::text,
    c.character_maximum_length
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = p_table_name
  ORDER BY c.ordinal_position;
$$;

-- Índices de uma tabela
CREATE OR REPLACE FUNCTION get_table_indexes(p_table_name text)
RETURNS TABLE (index_name text, index_definition text)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    i.indexname::text,
    i.indexdef::text
  FROM pg_indexes i
  WHERE i.schemaname = 'public'
    AND i.tablename = p_table_name
  ORDER BY i.indexname;
$$;

-- Políticas RLS de uma tabela
CREATE OR REPLACE FUNCTION get_table_policies(p_table_name text)
RETURNS TABLE (
  policy_name text,
  policy_definition text,
  policy_command text
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    p.policyname::text,
    pg_get_expr(p.qual, p.polrelid)::text,
    p.polcmd::text
  FROM pg_policy p
  JOIN pg_class c ON p.polrelid = c.oid
  WHERE c.relname = p_table_name
  ORDER BY p.policyname;
$$;
```

---

## Uso típico (introspecção antes de migração)

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 1. Listar tabelas
const { data: tables } = await supabase.rpc('get_schema_tables');

// 2. Detalhes de uma tabela
const { data: columns } = await supabase.rpc('get_table_columns', { p_table_name: 'leads' });
const { data: indexes } = await supabase.rpc('get_table_indexes', { p_table_name: 'leads' });
const { data: policies } = await supabase.rpc('get_table_policies', { p_table_name: 'leads' });

// 3. Analisar estado atual
const tableExists  = tables.some(t => t.table_name === 'leads');
const columnExists = columns?.some(c => c.column_name === 'notes');
const indexExists  = indexes?.some(i => i.index_name === 'idx_leads_email');
const policyExists = policies?.some(p => p.policy_name === 'users_own_leads');
```

---

## Migração idempotente (padrão)

```sql
-- Criar tabela apenas se não existe
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Adicionar coluna apenas se não existe
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Criar índice apenas se não existe
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);

-- Criar política apenas se não existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'leads'
      AND policyname = 'users_own_leads'
  ) THEN
    CREATE POLICY "users_own_leads" ON leads
      FOR ALL
      USING (auth.uid() = user_id);
  END IF;
END $$;
```

---

## Snapshot local (cache offline)

Após leitura bem-sucedida do banco, salve snapshot em `docs/schema_snapshot.json`:

```typescript
const schemaSnapshot = {
  timestamp: new Date().toISOString(),
  tables,
  tableDetails: {} as Record<string, unknown>,
};

for (const table of tables) {
  const [{ data: columns }, { data: indexes }, { data: policies }] = await Promise.all([
    supabase.rpc('get_table_columns', { p_table_name: table.table_name }),
    supabase.rpc('get_table_indexes', { p_table_name: table.table_name }),
    supabase.rpc('get_table_policies', { p_table_name: table.table_name }),
  ]);
  schemaSnapshot.tableDetails[table.table_name] = { columns, indexes, policies };
}

import { writeFileSync } from 'node:fs';
writeFileSync('docs/schema_snapshot.json', JSON.stringify(schemaSnapshot, null, 2));
```

---

## Fallback (se a conexão falhar)

Use `docs/schema_snapshot.json` como única fonte cacheada. Sempre adicione aviso na migração gerada a partir de cache:

```sql
-- WARNING: Generated from cached schema (last updated: <timestamp>)
-- Verify schema before applying migration
```

---

## Mapeamentos de requisito natural → PostgreSQL

| Linguagem natural | PostgreSQL |
|---|---|
| "UUID" | `UUID` |
| "Text" / "String" | `TEXT` |
| "Number" / "Integer" | `INTEGER` |
| "Decimal" / "Float" | `NUMERIC` ou `REAL` |
| "Boolean" / "True/False" | `BOOLEAN` |
| "Timestamp" / "Date and Time" | `TIMESTAMPTZ` |
| "Date" | `DATE` |
| "JSON Object" | `JSONB` |
| "Array of [type]" | `[type][]` |
| "Required" / "Not null" | `NOT NULL` |
| "Optional" | (sem constraint) |
| "Unique" | `UNIQUE` |
| "Primary Key" / "PK" | `PRIMARY KEY` |
| "Foreign Key to [table]([field])" | `REFERENCES [table]([field])` |
| "Cascade Delete" | `ON DELETE CASCADE` |
| "Auto-generated" (UUID) | `DEFAULT gen_random_uuid()` |
| "Auto-generated" (timestamp) | `DEFAULT NOW()` |
| "Max N chars" | `CHECK (length(field) <= N)` |
| "One of: [values]" | `CHECK (field IN ([values]))` |

### Padrões comuns de RLS

| Requisito | Política |
|---|---|
| "Usuários só acessam seus próprios registros" | `auth.uid() = user_id` |
| "Leitura pública, escrita autenticada" | Duas políticas: `SELECT` (public), `INSERT/UPDATE/DELETE` (authenticated) |
| "Apenas admin" | `auth.jwt() ->> 'role' = 'admin'` |
| "Dono ou admin" | `auth.uid() = user_id OR auth.jwt() ->> 'role' = 'admin'` |

---

## Referências

- Agente: [`agents/ops/db-admin.md`](../../agents/ops/db-admin.md)
- Filosofia (o que vai no banco vs aplicação): mesma persona, seção "Filosofia de banco"
