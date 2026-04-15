#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

console.log('→ Probing bootstrap RPCs...');
const probe = await supabase.rpc('get_schema_tables');
if (probe.error) {
  console.error('Probe failed:', probe.error.message);
  process.exit(1);
}
console.log(`  OK — ${probe.data.length} tables in public schema.`);

const snapshot = {
  timestamp: new Date().toISOString(),
  tables: probe.data,
  tableDetails: {},
};

for (const t of probe.data) {
  const [cols, idx, pol] = await Promise.all([
    supabase.rpc('get_table_columns', { p_table_name: t.table_name }),
    supabase.rpc('get_table_indexes', { p_table_name: t.table_name }),
    supabase.rpc('get_table_policies', { p_table_name: t.table_name }),
  ]);
  snapshot.tableDetails[t.table_name] = {
    columns: cols.data || [],
    indexes: idx.data || [],
    policies: pol.data || [],
  };
  console.log(`  ✓ ${t.table_name} — ${cols.data?.length || 0} cols, ${idx.data?.length || 0} idx, ${pol.data?.length || 0} policies`);
}

writeFileSync('docs/schema_snapshot.json', JSON.stringify(snapshot, null, 2));
console.log(`\n✓ Snapshot written to docs/schema_snapshot.json (${probe.data.length} tables)`);
