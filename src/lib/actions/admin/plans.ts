'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';
import { createClient } from '@/lib/supabase/server';
import {
  ListPlansSchema,
  CreatePlanSchema,
  UpdatePlanSchema,
  ArchivePlanSchema,
  DeletePlanSchema,
  type ListPlansInput,
  type CreatePlanInput,
  type UpdatePlanInput,
  type ArchivePlanInput,
  type DeletePlanInput,
} from './plans.schemas';

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

export interface PlanListItem {
  id: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number;
  isPublic: boolean;
  isArchived: boolean;
  maxUsers: number | null;
  maxLeads: number | null;
  maxProducts: number | null;
  maxPipelines: number | null;
  maxActiveIntegrations: number | null;
  maxStorageMb: number | null;
  allowAiFeatures: boolean;
  createdAt: string;
  updatedAt: string;
  activeSubscriptionsCount: number;
}

/* ------------------------------------------------------------------ */
/*  Error mapping                                                      */
/* ------------------------------------------------------------------ */

const RPC_ERROR_MESSAGES: Record<string, string> = {
  insufficient_privilege: 'Permissão insuficiente para esta ação.',
  plan_not_found:         'Plano não encontrado.',
  plan_name_taken:        'Já existe um plano com este nome.',
  plan_archived:          'Plano já está arquivado.',
  plan_in_use:            'Plano possui subscriptions ativas e não pode ser excluído.',
  invalid_plan_name:      'Nome do plano inválido (2–100 caracteres).',
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

/* ------------------------------------------------------------------ */
/*  Server Actions                                                     */
/* ------------------------------------------------------------------ */

export async function getPlansAction(
  input: ListPlansInput = {}
): Promise<ActionResponse<PlanListItem[]>> {
  const parsed = ListPlansSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    await requirePlatformAdmin();
    const supabase = await createClient();

    const { search, isPublic, isArchived, page, pageSize, sortBy, sortOrder } = parsed.data;
    const from = (page - 1) * pageSize;
    const to   = from + pageSize - 1;

    let query = supabase
      .from('plans')
      .select(
        'id, name, description, price_monthly_cents, price_yearly_cents, is_public, is_archived, ' +
        'max_users, max_leads, max_products, max_pipelines, max_active_integrations, max_storage_mb, ' +
        'allow_ai_features, created_at, updated_at',
        { count: 'exact' }
      )
      .eq('is_archived', isArchived ?? false);

    if (typeof isPublic === 'boolean') query = query.eq('is_public', isPublic);
    if (search && search.length > 0) {
      query = query.ilike('name', `%${search}%`);
    }

    const validSorts: Record<string, string> = {
      name: 'name',
      created_at: 'created_at',
      price_monthly_cents: 'price_monthly_cents',
    };
    query = query
      .order(validSorts[sortBy] ?? 'created_at', { ascending: sortOrder === 'asc' })
      .range(from, to);

    const { data: plansRaw, error, count } = await query;

    if (error) {
      console.error('[admin:plans:list]', error);
      return { success: false, error: 'Não foi possível carregar os planos.' };
    }

    const plans = (plansRaw ?? []) as unknown as Array<Record<string, unknown>>;
    const planIds = plans.map((p) => p.id as string);

    // Contar subscriptions ativas por plano (batch)
    const subsCountMap = new Map<string, number>();
    if (planIds.length > 0) {
      const { data: subsRaw } = await supabase
        .from('subscriptions')
        .select('plan_id')
        .in('plan_id', planIds)
        .in('status', ['trial', 'ativa', 'past_due']);

      for (const s of (subsRaw ?? []) as Array<{ plan_id: string }>) {
        subsCountMap.set(s.plan_id, (subsCountMap.get(s.plan_id) ?? 0) + 1);
      }
    }

    const items: PlanListItem[] = plans.map((p) => ({
      id:                    p.id as string,
      name:                  p.name as string,
      description:           (p.description as string | null) ?? null,
      priceMonthly:          p.price_monthly_cents as number,
      priceYearly:           p.price_yearly_cents as number,
      isPublic:              p.is_public as boolean,
      isArchived:            p.is_archived as boolean,
      maxUsers:              (p.max_users as number | null) ?? null,
      maxLeads:              (p.max_leads as number | null) ?? null,
      maxProducts:           (p.max_products as number | null) ?? null,
      maxPipelines:          (p.max_pipelines as number | null) ?? null,
      maxActiveIntegrations: (p.max_active_integrations as number | null) ?? null,
      maxStorageMb:          (p.max_storage_mb as number | null) ?? null,
      allowAiFeatures:       p.allow_ai_features as boolean,
      createdAt:             p.created_at as string,
      updatedAt:             p.updated_at as string,
      activeSubscriptionsCount: subsCountMap.get(p.id as string) ?? 0,
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
    console.error('[admin:plans:list] unexpected', error);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function getPlanDetailAction(
  id: string
): Promise<ActionResponse<PlanListItem>> {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(id)) {
    return { success: false, error: 'ID inválido.' };
  }

  try {
    await requirePlatformAdmin();
    const supabase = await createClient();

    const { data: planRaw, error } = await supabase
      .from('plans')
      .select(
        'id, name, description, price_monthly_cents, price_yearly_cents, is_public, is_archived, ' +
        'max_users, max_leads, max_products, max_pipelines, max_active_integrations, max_storage_mb, ' +
        'allow_ai_features, created_at, updated_at'
      )
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('[admin:plans:detail]', error);
      return { success: false, error: 'Não foi possível carregar o plano.' };
    }
    if (!planRaw) {
      return { success: false, error: 'Plano não encontrado.' };
    }

    const p = planRaw as unknown as Record<string, unknown>;

    const { count } = await supabase
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('plan_id', id)
      .in('status', ['trial', 'ativa', 'past_due']);

    return {
      success: true,
      data: {
        id:                    p.id as string,
        name:                  p.name as string,
        description:           (p.description as string | null) ?? null,
        priceMonthly:          p.price_monthly_cents as number,
        priceYearly:           p.price_yearly_cents as number,
        isPublic:              p.is_public as boolean,
        isArchived:            p.is_archived as boolean,
        maxUsers:              (p.max_users as number | null) ?? null,
        maxLeads:              (p.max_leads as number | null) ?? null,
        maxProducts:           (p.max_products as number | null) ?? null,
        maxPipelines:          (p.max_pipelines as number | null) ?? null,
        maxActiveIntegrations: (p.max_active_integrations as number | null) ?? null,
        maxStorageMb:          (p.max_storage_mb as number | null) ?? null,
        allowAiFeatures:       p.allow_ai_features as boolean,
        createdAt:             p.created_at as string,
        updatedAt:             p.updated_at as string,
        activeSubscriptionsCount: count ?? 0,
      },
    };
  } catch (error) {
    console.error('[admin:plans:detail] unexpected', error);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function createPlanAction(
  input: CreatePlanInput
): Promise<ActionResponse<{ id: string }>> {
  const parsed = CreatePlanSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    await requirePlatformAdminRole(['owner']);
    const supabase = await createClient();
    const { ip, ua } = await getRequestMeta();

    const {
      name, description, priceMonthly, priceYearly, featuresJsonb,
      isPublic, maxUsers, maxLeads, maxProducts, maxPipelines,
      maxActiveIntegrations, maxStorageMb, allowAiFeatures,
    } = parsed.data;

    const { data, error } = await supabase.rpc('admin_create_plan', {
      p_name:                   name,
      p_description:            description ?? null,
      p_price_monthly_cents:    priceMonthly,
      p_price_yearly_cents:     priceYearly,
      p_features_jsonb:         featuresJsonb,
      p_is_public:              isPublic,
      p_max_users:              maxUsers ?? null,
      p_max_leads:              maxLeads ?? null,
      p_max_products:           maxProducts ?? null,
      p_max_pipelines:          maxPipelines ?? null,
      p_max_active_integrations: maxActiveIntegrations ?? null,
      p_max_storage_mb:         maxStorageMb ?? null,
      p_allow_ai_features:      allowAiFeatures,
      p_ip_address:             ip,
      p_user_agent:             ua,
    });

    if (error) {
      console.error('[admin:plans:create] rpc', error);
      return { success: false, error: rpcErrorMessage(error) };
    }

    revalidatePath('/admin/plans');
    return { success: true, data: { id: data as string } };
  } catch (error) {
    console.error('[admin:plans:create] unexpected', error);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function updatePlanAction(
  input: UpdatePlanInput
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = UpdatePlanSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    await requirePlatformAdminRole(['owner']);
    const supabase = await createClient();
    const { ip, ua } = await getRequestMeta();

    const {
      id, name, description, priceMonthly, priceYearly, featuresJsonb,
      isPublic, maxUsers, maxLeads, maxProducts, maxPipelines,
      maxActiveIntegrations, maxStorageMb, allowAiFeatures,
    } = parsed.data;

    const { error } = await supabase.rpc('admin_update_plan', {
      p_plan_id:                id,
      p_name:                   name,
      p_description:            description ?? null,
      p_price_monthly_cents:    priceMonthly,
      p_price_yearly_cents:     priceYearly,
      p_features_jsonb:         featuresJsonb,
      p_is_public:              isPublic,
      p_max_users:              maxUsers ?? null,
      p_max_leads:              maxLeads ?? null,
      p_max_products:           maxProducts ?? null,
      p_max_pipelines:          maxPipelines ?? null,
      p_max_active_integrations: maxActiveIntegrations ?? null,
      p_max_storage_mb:         maxStorageMb ?? null,
      p_allow_ai_features:      allowAiFeatures,
      p_ip_address:             ip,
      p_user_agent:             ua,
    });

    if (error) {
      console.error('[admin:plans:update] rpc', error);
      return { success: false, error: rpcErrorMessage(error) };
    }

    revalidatePath('/admin/plans');
    revalidatePath(`/admin/plans/${id}/edit`);
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[admin:plans:update] unexpected', error);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function archivePlanAction(
  input: ArchivePlanInput
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = ArchivePlanSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    await requirePlatformAdminRole(['owner']);
    const supabase = await createClient();
    const { ip, ua } = await getRequestMeta();

    const { error } = await supabase.rpc('admin_archive_plan', {
      p_plan_id:    parsed.data.id,
      p_ip_address: ip,
      p_user_agent: ua,
    });

    if (error) {
      console.error('[admin:plans:archive] rpc', error);
      return { success: false, error: rpcErrorMessage(error) };
    }

    revalidatePath('/admin/plans');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[admin:plans:archive] unexpected', error);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function deletePlanAction(
  input: DeletePlanInput
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = DeletePlanSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    await requirePlatformAdminRole(['owner']);
    const supabase = await createClient();
    const { ip, ua } = await getRequestMeta();

    const { error } = await supabase.rpc('admin_delete_plan', {
      p_plan_id:    parsed.data.id,
      p_ip_address: ip,
      p_user_agent: ua,
    });

    if (error) {
      console.error('[admin:plans:delete] rpc', error);
      return { success: false, error: rpcErrorMessage(error) };
    }

    revalidatePath('/admin/plans');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[admin:plans:delete] unexpected', error);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}
