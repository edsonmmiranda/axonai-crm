import 'server-only';

import type { SessionContext, SessionRole } from '@/lib/supabase/getSessionContext';

export function assertRole(
  ctx: SessionContext,
  allowed: readonly SessionRole[]
): { ok: true } | { ok: false; error: string } {
  if (!allowed.includes(ctx.role)) {
    return { ok: false, error: 'Ação restrita a administradores.' };
  }
  return { ok: true };
}
