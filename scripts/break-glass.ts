/**
 * Sprint admin_12 — Break-glass CLI para recuperação de owner.
 *
 * Uso (após seedar o hash via runbook):
 *   tsx scripts/break-glass.ts <email>
 *
 * Pré-requisitos no env (cofres SEPARADOS — ver runbook):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY  (Vault A)
 *   - BREAK_GLASS_SECRET         (Vault B — rotação trimestral, distinta da service role)
 *   - BREAK_GLASS_OPERATOR       (identidade humana — nome/email/handle)
 *
 * Operação atômica (RPC `break_glass_recover_owner` em transação):
 *   1. Localiza profile pelo email
 *   2. UPSERT em platform_admins (role='owner', is_active=true)
 *   3. UPDATE profiles.mfa_reset_required=true
 *   4. INSERT em audit_log com action='break_glass.recover_owner' + metadata
 *   5. Auth Admin API: deleta TODOS os factors TOTP do user (fora da transação SQL — idempotente)
 *
 * Falha em qualquer etapa pré-RPC = nenhuma mudança no banco (fail-closed).
 * Falha pós-RPC em Auth Admin API = rerun do mesmo comando é seguro (estado convergente).
 */

import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { createClient } from '@supabase/supabase-js';

// Carrega .env.local manualmente (sem depender de `dotenv` — mesmo padrão de
// scripts/probe-auth-trigger.mjs). Variáveis já presentes em process.env têm
// prioridade (ex.: BREAK_GLASS_SECRET injetado via cofre externo, não via .env).
function loadDotEnvLocal(): void {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 0) continue;
    const key = trimmed.slice(0, i).trim();
    if (process.env[key] !== undefined) continue;
    const raw = trimmed.slice(i + 1).trim();
    process.env[key] = raw.replace(/^["']|["']$/g, '');
  }
}
loadDotEnvLocal();

function exit(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

interface BreakGlassRpcResult {
  profile_id:        string;
  platform_admin_id: string;
  audit_log_id:      string;
  was_active:        boolean | null;
  old_role:          string | null;
}

async function main(): Promise<void> {
  // ─────────────────────────────────────────────────────────────────────
  // 1. Env vars (fail-closed — todas obrigatórias antes de qualquer write)
  // ─────────────────────────────────────────────────────────────────────
  const url        = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret     = process.env.BREAK_GLASS_SECRET;
  const operator   = process.env.BREAK_GLASS_OPERATOR;

  if (!url)        exit('NEXT_PUBLIC_SUPABASE_URL missing');
  if (!serviceKey) exit('SUPABASE_SERVICE_ROLE_KEY missing');
  if (!secret)     exit('BREAK_GLASS_SECRET missing');
  if (!operator)   exit('BREAK_GLASS_OPERATOR missing (set to your name/email/handle)');

  // ─────────────────────────────────────────────────────────────────────
  // 2. Argumento email do alvo
  // ─────────────────────────────────────────────────────────────────────
  const argEmail = process.argv[2]?.toLowerCase().trim();
  if (!argEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(argEmail)) {
    exit('Usage: tsx scripts/break-glass.ts <email>');
  }
  const email = argEmail;

  // ─────────────────────────────────────────────────────────────────────
  // 3. Cliente Supabase com service role (sem session persistence)
  // ─────────────────────────────────────────────────────────────────────
  const sb = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ─────────────────────────────────────────────────────────────────────
  // 4. Validar BREAK_GLASS_SECRET via hash em platform_settings (decisão (c))
  // ─────────────────────────────────────────────────────────────────────
  const { data: expectedHash, error: hashErr } = await sb.rpc('get_break_glass_secret_hash');
  if (hashErr) exit(`Could not read secret hash: ${hashErr.message}`);
  if (!expectedHash) {
    exit('BREAK_GLASS_SECRET hash not configured — run setup SQL first (see docs/admin_area/runbook_break_glass.md)');
  }

  const computedHash = createHash('sha256').update(secret).digest('hex');
  if (computedHash !== expectedHash) {
    exit('BREAK_GLASS_SECRET invalid');
  }

  // ─────────────────────────────────────────────────────────────────────
  // 5. Confirmação digitada do email (RNF-UX-2)
  // ─────────────────────────────────────────────────────────────────────
  console.log('');
  console.log(`⚠  BREAK-GLASS: vai restaurar OWNER + invalidar MFA do profile com email '${email}'.`);
  console.log(`Operator: ${operator}`);
  console.log('');

  const rl = createInterface({ input: stdin, output: stdout });
  const typed = await rl.question(`Digite o email '${email}' para confirmar: `);
  rl.close();

  if (typed.toLowerCase().trim() !== email) {
    exit('Email confirmation mismatch — abort.');
  }

  // ─────────────────────────────────────────────────────────────────────
  // 6. RPC break_glass_recover_owner (decisão (d) — etapa 1, transacional)
  // ─────────────────────────────────────────────────────────────────────
  const originHost = process.env.HOSTNAME ?? hostname();
  const { data: rpcData, error: rpcErr } = await sb.rpc('break_glass_recover_owner', {
    p_email:       email,
    p_operator:    operator,
    p_origin_host: originHost,
  });
  if (rpcErr) exit(`RPC error: ${rpcErr.message}`);
  if (!rpcData) exit('RPC returned empty payload');

  const result = rpcData as BreakGlassRpcResult;

  // ─────────────────────────────────────────────────────────────────────
  // 7. Auth Admin API — invalidar TOTP factors (decisão (d) — etapa 2)
  // ─────────────────────────────────────────────────────────────────────
  const { data: usersList, error: listErr } = await sb.auth.admin.listUsers();
  if (listErr) {
    console.warn(`⚠  auth.admin.listUsers failed: ${listErr.message}`);
    console.warn('   RPC já restaurou o owner; rerun é seguro depois de resolver o erro.');
  } else {
    const target = usersList.users.find((u) => u.email?.toLowerCase() === email);
    if (!target) {
      console.warn(`⚠  Auth user not found for ${email} (RPC sucedeu — out-of-sync state).`);
      console.warn('   RPC restaurou platform_admins, mas auth.users entry está ausente.');
      console.warn('   Investigue manualmente via Supabase dashboard.');
    } else {
      const { data: factorsResp, error: factErr } = await sb.auth.admin.mfa.listFactors({
        userId: target.id,
      });
      if (factErr) {
        console.warn(`⚠  auth.admin.mfa.listFactors failed: ${factErr.message} (rerun é seguro).`);
      } else {
        const totps = factorsResp.factors.filter((f) => f.factor_type === 'totp');
        let deleted = 0;
        for (const f of totps) {
          const { error: delErr } = await sb.auth.admin.mfa.deleteFactor({
            userId: target.id,
            id:     f.id,
          });
          if (delErr) {
            console.warn(`⚠  deleteFactor ${f.id} failed: ${delErr.message} (rerun é seguro).`);
          } else {
            deleted++;
          }
        }
        console.log(`✓ MFA factors invalidated: ${deleted}/${totps.length}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // 8. Relatório final
  // ─────────────────────────────────────────────────────────────────────
  console.log('');
  console.log(`✓ Owner restored.`);
  console.log(`  profile_id        = ${result.profile_id}`);
  console.log(`  platform_admin_id = ${result.platform_admin_id}`);
  console.log(`  audit_log_id      = ${result.audit_log_id}`);
  if (result.was_active !== null) {
    console.log(`  Previous state    : was_active=${result.was_active}, old_role=${result.old_role}`);
  } else {
    console.log('  Previous state    : no platform_admins entry (created new)');
  }
  console.log('');
  console.log('Target must complete MFA re-enroll on next /admin/login.');
  console.log('(Sprint 11 mfa_reset_required flag forces redirect to /admin/mfa-enroll?reenroll=true)');
}

main().catch((err) => {
  exit(err instanceof Error ? err.message : String(err));
});
