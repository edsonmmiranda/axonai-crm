'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';
import { createClient } from '@/lib/supabase/server';
import {
  ListOrgsSchema,
  CreateOrgSchema,
  SuspendOrgSchema,
  ReactivateOrgSchema,
  type ListOrgsInput,
  type CreateOrgInput,
  type SuspendOrgInput,
  type ReactivateOrgInput,
} from './organizations.schemas';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: PaginationMeta;
}

interface PaginationMeta {
  total: number;
  totalPages: number;
  currentPage: number;
  itemsPerPage: number;
}

export interface OrgSubscriptionSummary {
  id: string;
  status: string;
  planId: string;
  planName: string;
  periodStart: string;
  periodEnd: string | null;
}

export interface OrgListItem {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  isInternal: boolean;
  createdAt: string;
  usersCount: number;
  subscription: OrgSubscriptionSummary | null;
}

export interface AuditLogEntry {
  id: string;
  occurredAt: string;
  actorEmail: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
}

export interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  isInternal: boolean;
  settings: Record<string, unknown>;
  createdAt: string;
  usersCount: number;
  lastActivityAt: string | null;
  subscription: (OrgSubscriptionSummary & {
    metadata: Record<string, unknown>;
    maxUsers: number | null;
    maxLeads: number | null;
    maxProducts: number | null;
    maxPipelines: number | null;
    maxActiveIntegrations: number | null;
    maxStorageMb: number | null;
    allowAiFeatures: boolean;
  }) | null;
  recentAuditLog: AuditLogEntry[];
}

/* ------------------------------------------------------------------ */
/*  Mapeamento de erros tipados da RPC → mensagem pt-BR              */
/* ------------------------------------------------------------------ */

const RPC_ERROR_MESSAGES: Record<string, string> = {
  internal_org_protected: 'A organização interna Axon não pode ser suspensa.',
  invalid_slug_format:    'Slug inválido. Use letras minúsculas, números e hífens (3–50 chars).',
  slug_taken:             'Este slug já está em uso. Escolha outro.',
  invalid_plan:           'Plano não encontrado ou arquivado. Selecione outro.',
  invalid_name:           'Nome deve ter entre 2 e 200 caracteres.',
  invalid_email:          'E-mail inválido.',
  invalid_trial_days:     'Dias de trial deve ser entre 1 e 365.',
  invalid_reason:         'Motivo deve ter entre 5 e 500 caracteres.',
  org_not_found:          'Organização não encontrada.',
  org_not_active:         'Organização já está suspensa.',
  org_not_suspended:      'Organização não está suspensa.',
  insufficient_privilege: 'Permissão insuficiente para esta ação.',
};

function rpcErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  for (const [code, label] of Object.entries(RPC_ERROR_MESSAGES)) {
    if (msg.includes(code)) return label;
  }
  return 'Erro interno. Tente novamente.';
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function getRequestMeta(): Promise<{ ip: string | null; ua: string | null }> {
  const hdrs = await headers();
  const forwarded = hdrs.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : hdrs.get('x-real-ip');
  const ua = hdrs.get('user-agent');
  return { ip, ua };
}

// Reads trial_default_days from platform_settings. Falls back to 14 if absent.
async function getTrialDefaultDays(supabase: Awaited<ReturnType<typeof createClient>>): Promise<number> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('value_int')
    .eq('key', 'trial_default_days')
    .maybeSingle();
  if (error || data?.value_int == null) {
    console.warn('[admin:orgs] trial_default_days unavailable, falling back to 14');
    return 14;
  }
  return data.value_int as number;
}

/* ------------------------------------------------------------------ */
/*  Server Actions                                                     */
/* ------------------------------------------------------------------ */

export async function getOrganizationsAction(
  input: ListOrgsInput = {}
): Promise<ActionResponse<OrgListItem[]>> {
  const parsed = ListOrgsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    await requirePlatformAdmin();
    const supabase = await createClient();

    const { search, isActive, planId, subStatus, page, pageSize, sortBy, sortOrder } = parsed.data;
    const from = (page - 1) * pageSize;
    const to   = from + pageSize - 1;

    let query = supabase
      .from('organizations')
      .select('id, name, slug, is_active, is_internal, created_at', { count: 'exact' });

    if (typeof isActive === 'boolean') query = query.eq('is_active', isActive);
    if (search && search.length > 0) {
      query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%`);
    }

    const validSorts: Record<string, string> = { name: 'name', created_at: 'created_at', is_active: 'is_active' };
    query = query.order(validSorts[sortBy] ?? 'created_at', { ascending: sortOrder === 'asc' });
    query = query.range(from, to);

    const { data: orgsRaw, error, count } = await query;

    if (error) {
      console.error('[admin:orgs:list]', error);
      return { success: false, error: 'Não foi possível carregar as organizações.' };
    }

    const orgs = (orgsRaw ?? []) as Array<Record<string, unknown>>;
    const orgIds = orgs.map((o) => o.id as string);

    if (orgIds.length === 0) {
      const total = count ?? 0;
      return {
        success: true,
        data: [],
        metadata: { total, totalPages: 1, currentPage: page, itemsPerPage: pageSize },
      };
    }

    // Fetch subscriptions + plans for the page
    // Note: planId / subStatus filters are applied here — orgs without matching
    // subscription will appear in the list with subscription=null (expected UX:
    // filter narrows which subscription is shown, not which orgs appear).
    let subsQuery = supabase
      .from('subscriptions')
      .select('id, organization_id, plan_id, status, period_start, period_end, plans(id, name)')
      .in('organization_id', orgIds);

    if (subStatus) subsQuery = subsQuery.eq('status', subStatus);
    if (planId)    subsQuery = subsQuery.eq('plan_id', planId);

    const { data: subsRaw } = await subsQuery;

    // User counts per org
    const { data: profileCounts } = await supabase
      .from('profiles')
      .select('organization_id')
      .in('organization_id', orgIds)
      .eq('is_active', true);

    const subsMap = new Map<string, OrgSubscriptionSummary>();
    for (const s of (subsRaw ?? []) as Array<Record<string, unknown>>) {
      const planRel = s.plans as { id: string; name: string } | null;
      subsMap.set(s.organization_id as string, {
        id:          s.id as string,
        status:      s.status as string,
        planId:      s.plan_id as string,
        planName:    planRel?.name ?? '—',
        periodStart: s.period_start as string,
        periodEnd:   (s.period_end as string | null) ?? null,
      });
    }

    const countsMap = new Map<string, number>();
    for (const p of (profileCounts ?? []) as Array<{ organization_id: string }>) {
      countsMap.set(p.organization_id, (countsMap.get(p.organization_id) ?? 0) + 1);
    }

    const items: OrgListItem[] = orgs.map((o) => ({
      id:          o.id as string,
      name:        o.name as string,
      slug:        o.slug as string,
      isActive:    o.is_active as boolean,
      isInternal:  o.is_internal as boolean,
      createdAt:   o.created_at as string,
      usersCount:  countsMap.get(o.id as string) ?? 0,
      subscription: subsMap.get(o.id as string) ?? null,
    }));

    const total = count ?? 0;
    return {
      success: true,
      data: items,
      metadata: {
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        currentPage: page,
        itemsPerPage: pageSize,
      },
    };
  } catch (error) {
    console.error('[admin:orgs:list] unexpected', error);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function getOrganizationDetailAction(
  id: string
): Promise<ActionResponse<OrgDetail>> {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(id)) {
    return { success: false, error: 'ID inválido.' };
  }

  try {
    await requirePlatformAdmin();
    const supabase = await createClient();

    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .select('id, name, slug, is_active, is_internal, settings, created_at')
      .eq('id', id)
      .maybeSingle();

    if (orgErr) {
      console.error('[admin:orgs:detail]', orgErr);
      return { success: false, error: 'Não foi possível carregar a organização.' };
    }
    if (!org) return { success: false, error: 'Organização não encontrada.' };

    const o = org as Record<string, unknown>;

    const [subResult, countResult, leadsActivity, profilesActivity, auditResult] = await Promise.all([
      // Leitura direta (a RPC `get_current_subscription` rejeita platform admin
      // lendo org diferente da própria; a policy `platform_admins_select_all_*`
      // em subscriptions/plans cobre o caso e ainda inclui status terminais
      // que a RPC oculta).
      supabase
        .from('subscriptions')
        .select(`id, status, plan_id, period_start, period_end, metadata,
                 plans:plan_id ( name, max_users, max_leads, max_products,
                   max_pipelines, max_active_integrations, max_storage_mb, allow_ai_features )`)
        .eq('organization_id', id)
        .order('period_start', { ascending: false })
        .limit(1)
        .maybeSingle(),
      // user count
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('organization_id', id).eq('is_active', true),
      // last lead update (best-effort)
      supabase.from('leads').select('updated_at').eq('organization_id', id).order('updated_at', { ascending: false }).limit(1),
      // last profile update (best-effort)
      supabase.from('profiles').select('updated_at').eq('organization_id', id).order('updated_at', { ascending: false }).limit(1),
      // recent audit
      supabase.from('audit_log')
        .select('id, occurred_at, actor_email_snapshot, action, metadata')
        .eq('target_organization_id', id)
        .order('occurred_at', { ascending: false })
        .limit(10),
    ]);

    if (subResult.error) {
      console.error('[admin:orgs:detail] subscription read', subResult.error);
    }

    const subRow = subResult.data as Record<string, unknown> | null;
    const planRow = (subRow?.plans ?? null) as Record<string, unknown> | null;
    const subscription = subRow
      ? {
          id:                   subRow.id as string,
          status:               subRow.status as string,
          planId:               subRow.plan_id as string,
          planName:             (planRow?.name as string) ?? '—',
          periodStart:          subRow.period_start as string,
          periodEnd:            (subRow.period_end as string | null) ?? null,
          metadata:             (subRow.metadata as Record<string, unknown>) ?? {},
          maxUsers:             (planRow?.max_users as number | null) ?? null,
          maxLeads:             (planRow?.max_leads as number | null) ?? null,
          maxProducts:          (planRow?.max_products as number | null) ?? null,
          maxPipelines:         (planRow?.max_pipelines as number | null) ?? null,
          maxActiveIntegrations:(planRow?.max_active_integrations as number | null) ?? null,
          maxStorageMb:         (planRow?.max_storage_mb as number | null) ?? null,
          allowAiFeatures:      (planRow?.allow_ai_features as boolean) ?? false,
        }
      : null;

    // last activity: max of lead + profile updated_at
    const leadAt    = (leadsActivity.data?.[0]?.updated_at as string | null) ?? null;
    const profileAt = (profilesActivity.data?.[0]?.updated_at as string | null) ?? null;
    const lastActivityAt = leadAt && profileAt
      ? (new Date(leadAt) > new Date(profileAt) ? leadAt : profileAt)
      : leadAt ?? profileAt;

    const recentAuditLog: AuditLogEntry[] = (auditResult.data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id:         r.id as string,
        occurredAt: r.occurred_at as string,
        actorEmail: (r.actor_email_snapshot as string | null) ?? null,
        action:     r.action as string,
        metadata:   (r.metadata as Record<string, unknown> | null) ?? null,
      };
    });

    return {
      success: true,
      data: {
        id:             o.id as string,
        name:           o.name as string,
        slug:           o.slug as string,
        isActive:       o.is_active as boolean,
        isInternal:     o.is_internal as boolean,
        settings:       (o.settings as Record<string, unknown>) ?? {},
        createdAt:      o.created_at as string,
        usersCount:     countResult.count ?? 0,
        lastActivityAt,
        subscription,
        recentAuditLog,
      },
    };
  } catch (error) {
    console.error('[admin:orgs:detail] unexpected', error);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function createOrganizationAction(
  input: CreateOrgInput
): Promise<ActionResponse<{ id: string; signupLink: string }>> {
  const parsed = CreateOrgSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    await requirePlatformAdminRole(['owner']);
    const supabase = await createClient();
    const { ip, ua } = await getRequestMeta();

    const { name, slug, planId, firstAdminEmail, trialDays } = parsed.data;
    const resolvedTrialDays = trialDays ?? await getTrialDefaultDays(supabase);

    const { data: newOrgId, error } = await supabase.rpc('admin_create_organization', {
      p_name:              name,
      p_slug:              slug,
      p_plan_id:           planId,
      p_first_admin_email: firstAdminEmail,
      p_trial_days:        resolvedTrialDays,
      p_ip_address:        ip,
      p_user_agent:        ua,
    });

    if (error) {
      console.error('[admin:orgs:create] rpc', error);
      return { success: false, error: rpcErrorMessage(error) };
    }

    const orgId = newOrgId as string;

    // Buscar token do convite recém-criado
    const { data: inv } = await supabase
      .from('invitations')
      .select('token')
      .eq('organization_id', orgId)
      .eq('email', firstAdminEmail)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const token = (inv as { token: string } | null)?.token ?? '';
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';
    if (!baseUrl) {
      console.warn('[admin:orgs:create] NEXT_PUBLIC_SITE_URL não configurada — signupLink vazio');
    }
    const signupLink = token ? `${baseUrl}/aceitar-convite?token=${token}` : '';

    revalidatePath('/admin/organizations');

    return { success: true, data: { id: orgId, signupLink } };
  } catch (error) {
    console.error('[admin:orgs:create] unexpected', error);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function suspendOrganizationAction(
  input: SuspendOrgInput
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = SuspendOrgSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    await requirePlatformAdminRole(['owner']);
    const supabase = await createClient();
    const { ip, ua } = await getRequestMeta();

    const { id, slugConfirmation, reason } = parsed.data;

    // Verificação de slug antes de chamar a RPC (defesa de UX)
    const { data: org } = await supabase
      .from('organizations')
      .select('slug')
      .eq('id', id)
      .maybeSingle();

    const orgSlug = (org as { slug: string } | null)?.slug;
    if (!orgSlug || orgSlug !== slugConfirmation) {
      return { success: false, error: 'Slug de confirmação não confere.' };
    }

    const { error } = await supabase.rpc('admin_suspend_organization', {
      p_org_id:     id,
      p_reason:     reason,
      p_ip_address: ip,
      p_user_agent: ua,
    });

    if (error) {
      console.error('[admin:orgs:suspend] rpc', error);
      return { success: false, error: rpcErrorMessage(error) };
    }

    revalidatePath('/admin/organizations');
    revalidatePath(`/admin/organizations/${id}`);

    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[admin:orgs:suspend] unexpected', error);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function reactivateOrganizationAction(
  input: ReactivateOrgInput
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = ReactivateOrgSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    await requirePlatformAdminRole(['owner']);
    const supabase = await createClient();
    const { ip, ua } = await getRequestMeta();

    const { id, slugConfirmation } = parsed.data;

    // Verificação de slug
    const { data: org } = await supabase
      .from('organizations')
      .select('slug')
      .eq('id', id)
      .maybeSingle();

    const orgSlug = (org as { slug: string } | null)?.slug;
    if (!orgSlug || orgSlug !== slugConfirmation) {
      return { success: false, error: 'Slug de confirmação não confere.' };
    }

    const { error } = await supabase.rpc('admin_reactivate_organization', {
      p_org_id:     id,
      p_ip_address: ip,
      p_user_agent: ua,
    });

    if (error) {
      console.error('[admin:orgs:reactivate] rpc', error);
      return { success: false, error: rpcErrorMessage(error) };
    }

    revalidatePath('/admin/organizations');
    revalidatePath(`/admin/organizations/${id}`);

    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[admin:orgs:reactivate] unexpected', error);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}
