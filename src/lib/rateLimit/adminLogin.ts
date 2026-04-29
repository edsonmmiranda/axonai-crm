import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';

const WINDOW_MINUTES = 10;
const MAX_PER_EMAIL  = 5;
const MAX_PER_IP     = 20;

export type RateLimitScope = 'email' | 'ip' | 'db_unavailable';

export class RateLimitError extends Error {
  public readonly scope: RateLimitScope;
  constructor(scope: RateLimitScope) {
    super(`rate_limit_${scope}`);
    this.scope = scope;
  }
}

interface RateLimitInput {
  email:     string;
  ip:        string;
  userAgent: string | null;
}

/**
 * Sprint admin_12 — Pre-flight rate limit check (decisão (b) — fail-closed).
 *
 * Throws `RateLimitError` quando atinge o limite OU quando DB indisponível.
 * Server Action `signInAdminAction` deve chamar **antes** de
 * `supabase.auth.signInWithPassword`.
 *
 * Limites:
 *  - 5 falhas por email em 10min
 *  - 20 falhas por IP em 10min (independente do email)
 *
 * Quando dispara: emite audit `auth.login_rate_limited` com
 * `metadata.scope` indicando qual limite estourou.
 */
export async function assertAdminLoginRateLimit(i: RateLimitInput): Promise<void> {
  const sb = createServiceClient();

  const { data, error } = await sb.rpc('count_admin_login_failures', {
    p_email:  i.email,
    p_ip:     i.ip,
    p_window: `${WINDOW_MINUTES} minutes`,
  });

  if (error) {
    console.error('[rate-limit:assert] db error', error);
    throw new RateLimitError('db_unavailable');
  }

  const counts = (data ?? { by_email: 0, by_ip: 0 }) as { by_email: number; by_ip: number };

  if (counts.by_email >= MAX_PER_EMAIL) {
    await emitRateLimitAudit(sb, i, 'email', counts.by_email);
    throw new RateLimitError('email');
  }
  if (counts.by_ip >= MAX_PER_IP) {
    await emitRateLimitAudit(sb, i, 'ip', counts.by_ip);
    throw new RateLimitError('ip');
  }
}

/**
 * Sprint admin_12 — Append em login_attempts_admin (decisão (b) — fail-open).
 *
 * Falha de DB **não** propaga — login do usuário legítimo não pode quebrar
 * porque o log perdeu uma linha. Usar APÓS `signInWithPassword` retornar.
 */
export async function recordAdminLoginAttempt(
  i: RateLimitInput & { success: boolean },
): Promise<void> {
  try {
    const sb = createServiceClient();
    const { error } = await sb.rpc('record_admin_login_attempt', {
      p_email:      i.email,
      p_ip:         i.ip,
      p_user_agent: i.userAgent,
      p_success:    i.success,
    });
    if (error) console.error('[rate-limit:record] db error', error);
  } catch (err) {
    console.error('[rate-limit:record] unexpected', err);
  }
}

async function emitRateLimitAudit(
  sb: ReturnType<typeof createServiceClient>,
  i: RateLimitInput,
  scope: 'email' | 'ip',
  attempts: number,
): Promise<void> {
  const { error } = await sb.rpc('audit_login_admin_event', {
    p_email:      i.email,
    p_ip:         i.ip,
    p_user_agent: i.userAgent,
    p_action:     'auth.login_rate_limited',
    p_metadata:   { scope, attempts, window_minutes: WINDOW_MINUTES },
  });
  if (error) console.error('[rate-limit:audit] db error', error);
}

export const ADMIN_LOGIN_RATE_LIMIT_CONFIG = {
  windowMinutes: WINDOW_MINUTES,
  maxPerEmail:   MAX_PER_EMAIL,
  maxPerIp:      MAX_PER_IP,
} as const;
