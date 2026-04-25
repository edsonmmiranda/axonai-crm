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

Antes de qualquer sprint, confirme que os helpers estão presentes chamando via MCP:

```
-- 1. Bootstrap mínimo presente?
mcp__supabase__execute_sql: "SELECT * FROM get_schema_tables() LIMIT 1"
```

Se retornar erro `function get_schema_tables() does not exist` → bootstrap não aplicado. Pare e peça ao usuário para rodar `supabase db push`.

```
-- 2. Helpers de auditoria presentes? (adicionados após o bootstrap inicial)
mcp__supabase__execute_sql: "SELECT * FROM get_rls_status('nonexistent') LIMIT 1"
```

Se retornar erro `function get_rls_status() does not exist` → bootstrap desatualizado. Pare e peça ao usuário para rodar `supabase db push`.

Se qualquer probe falhar, **não prossiga** — helpers ausentes invalidam toda introspecção.

---

## Helper functions (definição canônica)

Estas funções vivem no arquivo de bootstrap acima. Se precisar editá-las, edite o arquivo de bootstrap — **nunca duplique em migração separada**.

**Catálogo de helpers:**

| Helper | Consumido por | Retorna |
|---|---|---|
| `get_schema_tables()` | `@db-admin`, `@db-auditor` | Tabelas em `public` |
| `get_table_columns(p_table_name)` | `@db-admin`, `@db-auditor` | Colunas + `is_nullable` + defaults |
| `get_table_indexes(p_table_name)` | `@db-admin`, `@db-auditor` | Índices da tabela |
| `get_table_policies(p_table_name)` | `@db-admin`, `@db-auditor` | Policies RLS (expressão `USING`) |
| `get_table_foreign_keys(p_table_name)` | `@db-auditor` | FKs + `ON DELETE`/`ON UPDATE` |
| `get_rls_status(p_table_name)` | `@db-auditor` | Flag `relrowsecurity` (RLS enabled/forced) |
| `get_table_policy_checks(p_table_name)` | `@db-auditor` | Policies RLS (expressão `WITH CHECK` — complementa `get_table_policies`) |


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

-- Políticas RLS de uma tabela (expressão USING)
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

-- FKs de uma tabela (usado por @db-auditor)
-- Retorna constraint_name, column_name, referenced_table, referenced_column,
-- on_delete, on_update.

-- RLS status de uma tabela (usado por @db-auditor)
-- Retorna rls_enabled e rls_forced. Use para detectar tabelas com policies
-- definidas mas RLS desabilitado (failure mode silencioso).

-- Policy checks (WITH CHECK) de uma tabela (usado por @db-auditor)
-- Complementa get_table_policies — retorna with_check_definition por policy.
-- Necessário para auditar policies INSERT, cuja expressão vive em WITH CHECK
-- (não em USING).
```

> Para as definições completas desses três helpers, ver `supabase/migrations/00000000000000_framework_bootstrap.sql`.

---

## Uso típico (introspecção antes de migração)

Chame via MCP, **somente o necessário** para o sprint em andamento:

```
-- 1. Listar tabelas existentes
mcp__supabase__execute_sql: "SELECT * FROM get_schema_tables()"
-- Retorna: [{ table_name: "leads", table_type: "BASE TABLE" }, ...]

-- 2. Colunas de uma tabela específica
mcp__supabase__execute_sql: "SELECT * FROM get_table_columns('leads')"
-- Retorna: [{ column_name, data_type, is_nullable, column_default, character_maximum_length }, ...]

-- 3. Índices de uma tabela
mcp__supabase__execute_sql: "SELECT * FROM get_table_indexes('leads')"
-- Retorna: [{ index_name, index_definition }, ...]

-- 4. Políticas RLS de uma tabela
mcp__supabase__execute_sql: "SELECT * FROM get_table_policies('leads')"
-- Retorna: [{ policy_name, policy_definition, policy_command }, ...]
```

Com os resultados em mãos, analise o estado atual antes de gerar qualquer migration:

- `table_name` presente na lista → tabela existe
- `column_name` presente nas colunas → coluna existe (não use `ADD COLUMN`, use `ADD COLUMN IF NOT EXISTS` de todo jeito)
- `index_name` presente nos índices → índice já existe

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

## Fallback (se MCP offline)

**Não há cache local.** Se o MCP Supabase não responder, pare e reporte ao Tech Lead:

```
MCP Supabase indisponível — não consigo introspectar o schema.
Veja docs/setup/supabase-mcp.md para diagnóstico.
```

Não gere migration sem introspecção real — schema assumido é schema errado.

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
