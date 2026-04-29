'use server';

import 'server-only';

import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';
import { createClient } from '@/lib/supabase/server';
import {
  AUDIT_ACTION_REGISTRY,
  AUDIT_BILLING_PREFIXES,
  AUDIT_ACTION_PALETTE,
} from '@/lib/audit/actionRegistry';

import {
  AuditCursorSchema,
  AuditFiltersSchema,
  GetAuditEntrySchema,
  SearchAuditActorsSchema,
  type AuditCursor,
  type AuditFilters,
  type AuditLogRow,
  type AuditActorSearchRow,
  type AuditPeriod,
  type ListAuditResult,
} from './audit.schemas';

interface ActionResponse<T = unknown> {
  success: boolean;
  data?:   T;
  error?:  string;
}

const PAGE_SIZE = 50;

/* ─────────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────── */

interface AuditLogDbRow {
  id:                     string;
  occurred_at:            string;
  actor_profile_id:       string | null;
  actor_email_snapshot:   string | null;
  action:                 string;
  target_type:            string;
  target_id:              string | null;
  target_organization_id: string | null;
  diff_before:            Record<string, unknown> | null;
  diff_after:             Record<string, unknown> | null;
  ip_address:             string | null;
  user_agent:             string | null;
  metadata:               Record<string, unknown> | null;
}

function toCamel(row: AuditLogDbRow): AuditLogRow {
  return {
    id:                   row.id,
    occurredAt:           row.occurred_at,
    actorProfileId:       row.actor_profile_id,
    actorEmailSnapshot:   row.actor_email_snapshot,
    action:               row.action,
    targetType:           row.target_type,
    targetId:             row.target_id,
    targetOrganizationId: row.target_organization_id,
    diffBefore:           row.diff_before,
    diffAfter:            row.diff_after,
    ipAddress:            row.ip_address,
    userAgent:            row.user_agent,
    metadata:             row.metadata,
  };
}

function resolvePeriod(p: AuditPeriod | undefined): { from: string; to: string } | null {
  if (!p) return null;
  const now = Date.now();
  const to  = new Date(now).toISOString();
  if (p.preset === 'custom') return { from: p.from, to: p.to };
  const offsets: Record<'24h' | '7d' | '30d', number> = {
    '24h': 24 * 3600 * 1000,
    '7d':   7 * 24 * 3600 * 1000,
    '30d': 30 * 24 * 3600 * 1000,
  };
  return { from: new Date(now - offsets[p.preset]).toISOString(), to };
}

/* ─────────────────────────────────────────────────────────────────────────
 * listAuditLogAction
 * ────────────────────────────────────────────────────────────────────── */

export async function listAuditLogAction(
  filters: AuditFilters = {},
  cursor?: AuditCursor,
): Promise<ActionResponse<ListAuditResult>> {
  const filtersParsed = AuditFiltersSchema.safeParse(filters);
  if (!filtersParsed.success) {
    return { success: false, error: filtersParsed.error.issues[0]?.message ?? 'Filtros inválidos.' };
  }
  const cursorParsed = cursor ? AuditCursorSchema.safeParse(cursor) : null;
  if (cursor && cursorParsed && !cursorParsed.success) {
    return { success: false, error: 'Cursor inválido.' };
  }

  try {
    const admin    = await requirePlatformAdmin(); // notFound() se não-admin
    const supabase = await createClient();

    let q = supabase
      .from('audit_log')
      .select('*')
      .order('occurred_at', { ascending: false })
      .order('id',          { ascending: false })
      .limit(PAGE_SIZE + 1);

    // RBAC condicional para billing (decisão (f))
    if (admin.role === 'billing') {
      const orClause = AUDIT_BILLING_PREFIXES
        .map((p) => `action.like.${p}.%`)
        .join(',');
      q = q.or(orClause);
    }

    const f = filtersParsed.data;
    if (f.actions && f.actions.length > 0) q = q.in('action',                f.actions);
    if (f.actorProfileId)                  q = q.eq('actor_profile_id',      f.actorProfileId);
    if (f.targetOrgId)                     q = q.eq('target_organization_id', f.targetOrgId);
    if (f.targetType)                      q = q.eq('target_type',           f.targetType);

    const period = resolvePeriod(f.period);
    if (period) {
      q = q.gte('occurred_at', period.from).lte('occurred_at', period.to);
    }

    if (cursorParsed && cursorParsed.success) {
      const c = cursorParsed.data;
      q = q.or(
        `occurred_at.lt.${c.occurredAt},and(occurred_at.eq.${c.occurredAt},id.lt.${c.id})`,
      );
    }

    const { data, error } = await q;
    if (error) {
      console.error('[admin:audit:list]', error);
      return { success: false, error: 'Não foi possível carregar o audit.' };
    }

    const all     = (data ?? []) as AuditLogDbRow[];
    const hasMore = all.length > PAGE_SIZE;
    const rows    = all.slice(0, PAGE_SIZE).map(toCamel);
    const last    = rows[rows.length - 1];
    const nextCursor: AuditCursor | null = hasMore && last
      ? { occurredAt: last.occurredAt, id: last.id }
      : null;

    return { success: true, data: { rows, nextCursor } };
  } catch (err) {
    console.error('[admin:audit:list] unexpected', err);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * getAuditLogEntryAction
 * ────────────────────────────────────────────────────────────────────── */

export async function getAuditLogEntryAction(
  id: string,
): Promise<ActionResponse<AuditLogRow>> {
  const parsed = GetAuditEntrySchema.safeParse({ id });
  if (!parsed.success) {
    return { success: false, error: 'audit_entry_not_found' };
  }

  try {
    const admin    = await requirePlatformAdmin();
    const supabase = await createClient();

    let q = supabase
      .from('audit_log')
      .select('*')
      .eq('id', parsed.data.id)
      .limit(1);

    if (admin.role === 'billing') {
      const orClause = AUDIT_BILLING_PREFIXES
        .map((p) => `action.like.${p}.%`)
        .join(',');
      q = q.or(orClause);
    }

    const { data, error } = await q.maybeSingle<AuditLogDbRow>();
    if (error) {
      console.error('[admin:audit:get]', error);
      return { success: false, error: 'Erro interno. Tente novamente.' };
    }
    if (!data) {
      // Mensagem genérica cobre tanto "não existe" quanto "fora do escopo billing".
      return { success: false, error: 'audit_entry_not_found' };
    }

    return { success: true, data: toCamel(data) };
  } catch (err) {
    console.error('[admin:audit:get] unexpected', err);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * searchAuditActorsAction
 * ────────────────────────────────────────────────────────────────────── */

export async function searchAuditActorsAction(
  query: string,
): Promise<ActionResponse<AuditActorSearchRow[]>> {
  const parsed = SearchAuditActorsSchema.safeParse({ query });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Busca inválida.' };
  }

  try {
    await requirePlatformAdmin();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('audit_log')
      .select('actor_profile_id, actor_email_snapshot, occurred_at')
      .not('actor_profile_id', 'is', null)
      .ilike('actor_email_snapshot', `%${parsed.data.query}%`)
      .order('occurred_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[admin:audit:search-actors]', error);
      return { success: false, error: 'Erro interno. Tente novamente.' };
    }

    const seen = new Set<string>();
    const rows: AuditActorSearchRow[] = [];
    for (const r of (data ?? []) as Array<{ actor_profile_id: string | null; actor_email_snapshot: string | null }>) {
      if (!r.actor_profile_id || seen.has(r.actor_profile_id)) continue;
      seen.add(r.actor_profile_id);
      rows.push({ actorProfileId: r.actor_profile_id, actorEmailSnapshot: r.actor_email_snapshot });
      if (rows.length >= 10) break;
    }

    return { success: true, data: rows };
  } catch (err) {
    console.error('[admin:audit:search-actors] unexpected', err);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * getAuditActionRegistryAction
 * ────────────────────────────────────────────────────────────────────── */

export interface AuditActionRegistryPayload {
  registry: typeof AUDIT_ACTION_REGISTRY;
  palette:  typeof AUDIT_ACTION_PALETTE;
}

/**
 * Lista canônica de slugs agrupados por prefixo + paleta de cores.
 * Não consulta DB — registry é metadata estática (atualizada ao adicionar
 * novos slugs em sprints futuros).
 */
export async function getAuditActionRegistryAction(): Promise<ActionResponse<AuditActionRegistryPayload>> {
  try {
    await requirePlatformAdmin();
    return {
      success: true,
      data: {
        registry: AUDIT_ACTION_REGISTRY,
        palette:  AUDIT_ACTION_PALETTE,
      },
    };
  } catch (err) {
    console.error('[admin:audit:registry] unexpected', err);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}
