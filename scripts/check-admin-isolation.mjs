import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import process from 'node:process';

const PROTECTED_IMPORT = '@/lib/auth/platformAdmin';
const SCAN_ROOTS = ['src/app/(app)', 'src/lib/actions'];
const IMPORT_RE = /(?:from\s+['"]|require\(\s*['"])@\/lib\/auth\/platformAdmin\b/;

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
    const content = await readFile(f, 'utf8');
    if (IMPORT_RE.test(content)) {
      violations.push(relative(process.cwd(), f));
    }
  }
}

if (violations.length > 0) {
  console.error('❌ check-admin-isolation: customer-app files must not import @/lib/auth/platformAdmin');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log(`✅ check-admin-isolation: ${SCAN_ROOTS.join(', ')} — clean of ${PROTECTED_IMPORT}`);
