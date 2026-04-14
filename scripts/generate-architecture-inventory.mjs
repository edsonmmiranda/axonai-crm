#!/usr/bin/env node
// Auto-generates docs/architecture_state.auto.md from real code.
// Run at sprint closing. Never edit the output manually.

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, 'docs', 'architecture_state.auto.md');

function walk(dir, filter) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

function rel(p) {
  return relative(ROOT, p).split(sep).join('/');
}

function scanRoutes() {
  const base = join(ROOT, 'src', 'app');
  if (!existsSync(base)) return [];
  return walk(base, (p) => /[\\/]page\.(tsx|ts|jsx|js)$/.test(p))
    .map((p) => {
      const r = rel(p).replace(/^src\/app/, '').replace(/\/page\.[^/]+$/, '') || '/';
      return { route: r || '/', file: rel(p) };
    })
    .sort((a, b) => a.route.localeCompare(b.route));
}

function scanActions() {
  const base = join(ROOT, 'src', 'lib', 'actions');
  if (!existsSync(base)) return [];
  const files = walk(base, (p) => /\.ts$/.test(p));
  const out = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const re = /export\s+async\s+function\s+([A-Za-z0-9_]+Action)\s*\(/g;
    let m;
    while ((m = re.exec(src))) out.push({ name: m[1], file: rel(f) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function scanIntegrations() {
  const base = join(ROOT, 'src', 'lib', 'integrations');
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((n) => statSync(join(base, n)).isDirectory())
    .map((n) => ({ name: n, dir: `src/lib/integrations/${n}/` }));
}

function scanMigrations() {
  const base = join(ROOT, 'supabase', 'migrations');
  if (!existsSync(base)) return { files: [], tables: [] };
  const files = readdirSync(base).filter((n) => n.endsWith('.sql')).sort();
  const tables = new Set();
  for (const f of files) {
    const src = readFileSync(join(base, f), 'utf8');
    const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?["`]?([a-z_][a-z0-9_]*)["`]?/gi;
    let m;
    while ((m = re.exec(src))) tables.add(m[1]);
  }
  return { files, tables: [...tables].sort() };
}

function scanUiComponents() {
  const base = join(ROOT, 'src', 'components', 'ui');
  if (!existsSync(base)) return [];
  return walk(base, (p) => /\.(tsx|ts)$/.test(p) && !/\.test\./.test(p))
    .map((p) => rel(p))
    .sort();
}

const routes = scanRoutes();
const actions = scanActions();
const integrations = scanIntegrations();
const migrations = scanMigrations();
const uiComponents = scanUiComponents();

const lines = [];
lines.push('# Architecture State — Auto-Generated Inventory');
lines.push('');
lines.push('> ⚠️ **This file is auto-generated.** Do not edit by hand.');
lines.push('> Regenerated at sprint closing via `node scripts/generate-architecture-inventory.mjs`.');
lines.push('> Narrative context (why modules exist, architectural decisions) lives in [`architecture_state.md`](./architecture_state.md).');
lines.push('');
lines.push(`**Generated:** ${new Date().toISOString()}`);
lines.push('');
lines.push('---');
lines.push('');
lines.push('## 🗄️ Database Tables');
lines.push('');
if (migrations.tables.length === 0) lines.push('_None detected._');
else migrations.tables.forEach((t) => lines.push(`- \`${t}\``));
lines.push('');
lines.push('## 📜 Migrations');
lines.push('');
if (migrations.files.length === 0) lines.push('_None._');
else migrations.files.forEach((f) => lines.push(`- \`supabase/migrations/${f}\``));
lines.push('');
lines.push('## 🌐 Routes');
lines.push('');
if (routes.length === 0) lines.push('_None._');
else {
  lines.push('| Route | File |');
  lines.push('|---|---|');
  routes.forEach((r) => lines.push(`| \`${r.route}\` | \`${r.file}\` |`));
}
lines.push('');
lines.push('## ⚙️ Server Actions');
lines.push('');
if (actions.length === 0) lines.push('_None._');
else {
  lines.push('| Action | File |');
  lines.push('|---|---|');
  actions.forEach((a) => lines.push(`| \`${a.name}\` | \`${a.file}\` |`));
}
lines.push('');
lines.push('## 🔌 External Integrations');
lines.push('');
if (integrations.length === 0) lines.push('_None._');
else integrations.forEach((i) => lines.push(`- **${i.name}** — \`${i.dir}\``));
lines.push('');
lines.push('## 🎨 UI Components (design system wrappers)');
lines.push('');
if (uiComponents.length === 0) lines.push('_None._');
else uiComponents.forEach((c) => lines.push(`- \`${c}\``));
lines.push('');

writeFileSync(OUT, lines.join('\n'));
console.log(`Wrote ${rel(OUT)}`);
console.log(`  Tables: ${migrations.tables.length}  Routes: ${routes.length}  Actions: ${actions.length}  Integrations: ${integrations.length}  UI: ${uiComponents.length}`);
