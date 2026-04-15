#!/usr/bin/env node
import { readFileSync } from 'node:fs';
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

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data, error } = await supabase.rpc('get_table_triggers', {
  p_schema: 'auth',
  p_table_name: 'users',
});

if (error) {
  console.error('Probe failed:', error);
  process.exit(1);
}

console.log(`Triggers on auth.users: ${data.length}`);
for (const t of data) {
  console.log(`\n  ${t.trigger_name}  [${t.action_timing} ${t.event_manipulation}]`);
  console.log(`    ${t.action_statement}`);
}

// Also probe role CHECK constraints on profiles and invitations
for (const tbl of ['profiles', 'invitations']) {
  const { data: cols } = await supabase.rpc('get_table_columns', { p_table_name: tbl });
  const roleCol = cols?.find((c) => c.column_name === 'role');
  console.log(`\n${tbl}.role: default=${roleCol?.column_default}, nullable=${roleCol?.is_nullable}`);
}
