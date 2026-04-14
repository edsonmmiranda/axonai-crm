#!/usr/bin/env node
// Static portion of GATE 5 (design verification).
// Checa violações estruturais sem precisar de browser/screenshot.
// Usage:
//   node scripts/verify-design.mjs            # inspeciona todo src/
//   node scripts/verify-design.mjs --changed  # só arquivos no diff atual

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const changedOnly = process.argv.includes('--changed');

function listFiles() {
  try {
    const cmd = changedOnly
      ? 'git diff --name-only HEAD'
      : 'git ls-files src';
    const out = execSync(cmd, { encoding: 'utf8' });
    return out.split('\n')
      .map(f => f.trim())
      .filter(f => /^src\/.*\.(tsx|ts)$/.test(f))
      .filter(f => existsSync(f));
  } catch {
    return [];
  }
}

const files = listFiles();
if (files.length === 0) {
  console.log('verify-design: nenhum arquivo src/**/*.{ts,tsx} para inspecionar.');
  console.log('(Se este for um sprint de bootstrap, o GATE 5 estático fica adiado.)');
  process.exit(0);
}

const violations = [];

const LINE_RULES = [
  {
    id: 'arbitrary-dimension',
    desc: 'Width/height arbitrários (w-[Xpx], h-[Xrem]). Use tokens do design system.',
    test: (line) => {
      const m = line.match(/\b(?:min-|max-)?[wh]-\[[^\]]+\]/g);
      return m || null;
    },
  },
  {
    id: 'hex-in-classname',
    desc: 'Cor hex literal em className. Use variáveis do tema (bg-primary, text-foreground...).',
    test: (line) => {
      if (!/\b(className|class)\s*=/.test(line)) return null;
      const m = line.match(/#[0-9a-fA-F]{3,8}\b/g);
      return m || null;
    },
  },
  {
    id: 'inline-style',
    desc: 'Atributo style inline. Prefira utilitários Tailwind.',
    test: (line) => {
      const m = line.match(/\bstyle=\{\{[^}]+\}\}/);
      return m ? [m[0]] : null;
    },
  },
  {
    id: 'arbitrary-color',
    desc: 'Cor arbitrária Tailwind (bg-[#xxx], text-[#xxx]). Use tokens do tema.',
    test: (line) => {
      const m = line.match(/\b(?:bg|text|border|ring|outline|fill|stroke)-\[[^\]]+\]/g);
      return m || null;
    },
  },
];

for (const file of files) {
  let content;
  try { content = readFileSync(file, 'utf8'); } catch { continue; }
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of LINE_RULES) {
      const hits = rule.test(line);
      if (hits) {
        violations.push({
          file,
          line: i + 1,
          rule: rule.id,
          snippet: hits.join(', '),
          desc: rule.desc,
        });
      }
    }
  }
}

// Page-level: pages internas em src/app/**/page.tsx devem ter AppLayout
// (direto no page.tsx ou em algum layout.tsx ancestor).
// Pulamos rotas públicas marcadas por route groups (public), (marketing), (auth).
const internalPages = files.filter(f =>
  /^src\/app\/.*\/page\.tsx$/.test(f) &&
  !/\((public|marketing|auth)\)/.test(f)
);

for (const page of internalPages) {
  const content = readFileSync(page, 'utf8');
  if (/\bAppLayout\b/.test(content)) continue;

  let cursor = page.replace(/\/page\.tsx$/, '');
  let found = false;
  while (cursor.startsWith('src/app')) {
    const layoutPath = `${cursor}/layout.tsx`;
    if (existsSync(layoutPath)) {
      try {
        const c = readFileSync(layoutPath, 'utf8');
        if (/\bAppLayout\b/.test(c)) { found = true; break; }
      } catch {}
    }
    const next = cursor.slice(0, cursor.lastIndexOf('/'));
    if (next === cursor || !next.startsWith('src/app')) break;
    cursor = next;
  }

  if (!found) {
    violations.push({
      file: page,
      line: 1,
      rule: 'missing-applayout',
      snippet: '(page.tsx)',
      desc: 'Página interna sem AppLayout (nem direto, nem via layout.tsx ancestor).',
    });
  }
}

if (violations.length === 0) {
  console.log(`verify-design ✅ ${files.length} arquivo(s) inspecionado(s), 0 violações.`);
  console.log('Restam checagens manuais (responsividade 375/1440, comparação side-by-side,');
  console.log('labels em português). Ver docs/PROCESS_DESIGN_VERIFICATION.md seção "Manual".');
  process.exit(0);
}

console.log(`verify-design ❌ ${violations.length} violação(ões):\n`);
for (const v of violations) {
  console.log(`  ${v.file}:${v.line}  [${v.rule}]`);
  console.log(`    → ${v.desc}`);
  console.log(`    snippet: ${v.snippet}\n`);
}
process.exit(1);
