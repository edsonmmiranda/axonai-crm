import 'server-only';
import { createClient } from '@/lib/supabase/server';

export interface WriteAuditParams {
  action: string;
  targetType: string;
  targetId?: string;
  targetOrganizationId?: string;
  diffBefore?: unknown;
  diffAfter?: unknown;
  metadata?: Record<string, unknown>;
  /**
   * Quando true, falhas do audit_write são logadas mas não propagadas.
   * Usar apenas em Server Actions sem RPC dedicada — o audit é best-effort.
   * Mutations com RPC dedicada (Sprints 05+) NÃO usam este helper:
   * chamam audit_write de dentro do corpo PL/pgSQL da própria RPC.
   * Ver: docs/conventions/audit.md
   */
  bestEffort?: boolean;
}

function extractIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (isPublicIp(first)) return first;
  }
  const realIp = request.headers.get('x-real-ip')?.trim() ?? null;
  if (realIp && isPublicIp(realIp)) return realIp;
  return null;
}

function isPublicIp(ip: string): boolean {
  if (!ip) return false;
  // Loopback
  if (ip === '::1' || ip.startsWith('::ffff:127.') || /^127\./.test(ip)) return false;
  // RFC 1918 private ranges
  if (/^10\./.test(ip)) return false;
  if (/^192\.168\./.test(ip)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false;
  return true;
}

export async function writeAudit(
  params: WriteAuditParams,
  request?: Request
): Promise<string | null> {
  const supabase = await createClient();

  const ipAddress = request ? extractIp(request) : null;
  const userAgent = request?.headers.get('user-agent') ?? null;

  const { data, error } = await supabase.rpc('audit_write', {
    action: params.action,
    target_type: params.targetType,
    target_id: params.targetId ?? null,
    target_organization_id: params.targetOrganizationId ?? null,
    diff_before: params.diffBefore ?? null,
    diff_after: params.diffAfter ?? null,
    metadata: params.metadata ?? null,
    ip_address: ipAddress,
    user_agent: userAgent,
  });

  if (error) {
    if (params.bestEffort) {
      console.error('[audit] best-effort write failed:', error);
      return null;
    }
    throw new Error(`audit_write failed: ${error.message}`);
  }

  return data as string;
}
