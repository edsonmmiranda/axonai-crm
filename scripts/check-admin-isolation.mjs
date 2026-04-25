import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import process from 'node:process';

const SCAN_ROOTS = ['src/app/(app)', 'src/lib/actions'];

// Directories that are intentionally admin-only — excluded from isolation scan
const EXCLUDED_PREFIXES = ['src/lib/actions/admin'];

// Patterns forbidden in imports from customer-app files
const FORBIDDEN = [
  {
    re: /(?:from\s+['"]|require\(\s*['"])@\/lib\/auth\/platformAdmin\b/,
    label: '@/lib/auth/platformAdmin',
  },
  {
    re: /(?:from\s+['"]|require\(\s*['"])[^'"]*\(admin\)[^'"]*['"]/,
    label: 'src/app/(admin)/**',
  },
];

async function walk(dir, out = []) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full, out);
      else if (/\.(tsx?|mjs|cjs|js)$/.test(e.name)) out.push(full);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return out;
}

const violations = [];
for (const root of SCAN_ROOTS) {
  const files = await walk(root);
  for (const f of files) {
    const rel = relative(process.cwd(), f).replace(/\\/g, '/');
    // Skip files that live in admin-only directories
    if (EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
    const content = await readFile(f, 'utf8');
    for (const { re, label } of FORBIDDEN) {
      if (re.test(content)) {
        violations.push({ file: rel, label });
      }
    }
  }
}

if (violations.length > 0) {
  console.error('❌ check-admin-isolation: customer-app files must not import admin-only modules');
  for (const { file, label } of violations) {
    console.error(`  - ${file}  (forbidden: ${label})`);
  }
  process.exit(1);
}
console.log(`✅ check-admin-isolation: ${SCAN_ROOTS.join(', ')} — clean`);
