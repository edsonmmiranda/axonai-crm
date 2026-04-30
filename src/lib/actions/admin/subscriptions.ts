'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  ChangePlanSchema,
  ExtendTrialSchema,
  CancelSubscriptionSchema,
  ReactivateSubscriptionSchema,
  MarkPastDueSchema,
  type ChangePlanInput,
  type ExtendTrialInput,
  type CancelSubscriptionInput,
  type ReactivateSubscriptionInput,
  type MarkPastDueInput,
} from './subscriptions.schemas';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface OrgSubscriptionDetail {
  subscriptionId: string;
  status: string;
  planId: string;
  planName: string;
  periodStart: string;
  periodEnd: string | null;
  metadata: { trial_days_override?: number } & Record<string, unknown>;
  limits: {
    maxUsers: number | null;
    maxLeads: number | null;
    maxProducts: number | null;
    maxPipelines: number | null;
    maxActiveIntegrations: number | null;
    maxStorageMb: number | null;
    allowAiFeatures: boolean;
  };
}

/* ------------------------------------------------------------------ */
/*  Error mapping                                                      */
/* ------------------------------------------------------------------ */

const RPC_ERROR_MESSAGES: Record<string, string> = {
  insufficient_privilege:               'Permissão insuficiente para esta ação.',
  subscription_not_found:               'Subscription não encontrada.',
  subscription_not_active:              'Subscription não está em estado ativo.',
  not_in_trial:                         'Extensão de trial só é possível enquanto a subscription estiver em trial.',
  already_cancelled:                    'Subscription já está cancelada.',
  not_cancellable:                      'Apenas subscriptions canceladas ou expiradas podem ser reativadas.',
  org_already_has_active_subscription:  'Organização já possui uma subscription ativa.',
  plan_not_found:                       'Plano não encontrado ou arquivado.',
  downgrade_users_exceed:               'Downgrade inválido: a organização possui mais usuários do que o limite do novo plano.',
  downgrade_leads_exceed:               'Downgrade inválido: a organização possui mais leads do que o limite do novo plano.',
  downgrade_products_exceed:            'Downgrade inválido: a organização possui mais produtos do que o limite do novo plano.',
  downgrade_pipelines_exceed:           'Downgrade inválido: a organização possui mais pipelines do que o limite do novo plano.',
  invalid_trial_days:                   'Dias de trial deve ser entre 1 e 365.',
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

function revalidateOrgSubs(orgId: string) {
  revalidatePath(`/admin/organizations/${orgId}/subscription`);
  revalidatePath(`/admin/organizations/${orgId}`);
  revalidatePath('/admin/organizations');
}

/* ------------------------------------------------------------------ */
/*  Server Actions                                                     */
/* ------------------------------------------------------------------ */

export async function getOrgSubscriptionAction(
  orgId: string
): Promise<ActionResponse<OrgSubscriptionDetail>> {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(orgId)) {
    return { success: false, error: 'ID inválido.' };
  }

  try {
    await requirePlatformAdmin();
    const supabase = await createClient();

    // Leitura direta (a RPC `get_current_subscription` rejeita platform admin
    // lendo org diferente da própria; a policy `platform_admins_select_all_*`
    // em subscriptions/plans cobre o caso e ainda inclui status terminais
    // que a RPC oculta).
    const { data, error } = await supabase
      .from('subscriptions')
      .select(`id, status, plan_id, period_start, period_end, metadata,
               plans:plan_id ( name, max_users, max_leads, max_products,
                 max_pipelines, max_active_integrations, max_storage_mb, allow_ai_features )`)
      .eq('organization_id', orgId)
      .order('period_start', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[admin:subs:get]', error);
      return { success: false, error: 'Não foi possível carregar a subscription.' };
    }

    const row = data as Record<string, unknown> | null;
    if (!row) {
      return { success: false, error: 'Nenhuma subscription encontrada para esta organização.' };
    }

    const planRow = (row.plans ?? null) as Record<string, unknown> | null;

    return {
      success: true,
      data: {
        subscriptionId:  row.id as string,
        status:          row.status as string,
        planId:          row.plan_id as string,
        planName:        (planRow?.name as string) ?? '—',
        periodStart:     row.period_start as string,
        periodEnd:       (row.period_end as string | null) ?? null,
        metadata:        (row.metadata as Record<string, unknown>) ?? {},
        limits: {
          maxUsers:              (planRow?.max_users as number | null) ?? null,
          maxLeads:              (planRow?.max_leads as number | null) ?? null,
          maxProducts:           (planRow?.max_products as number | null) ?? null,
          maxPipelines:          (planRow?.max_pipelines as number | null) ?? null,
          maxActiveIntegrations: (planRow?.max_active_integrations as number | null) ?? null,
          maxStorageMb:          (planRow?.max_storage_mb as number | null) ?? null,
          allowAiFeatures:       (planRow?.allow_ai_features as boolean) ?? false,
        },
      },
    };
  } catch (error) {
    console.error('[admin:subs:get] unexpected', error);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function changePlanAction(
  orgId: string,
  input: ChangePlanInput
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = ChangePlanSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    await requirePlatformAdminRole(['owner', 'billing']);
    const supabase = await createClient();
    const { ip, ua } = await getRequestMeta();

    const { subscriptionId, newPlanId, effectiveAt } = parsed.data;

    const { error } = await supabase.rpc('admin_change_plan', {
      p_subscription_id: subscriptionId,
      p_new_plan_id:     newPlanId,
      p_effective_at:    effectiveAt ?? new Date().toISOString(),
      p_ip_address:      ip,
      p_user_agent:      ua,
    });

    if (error) {
      console.error('[admin:subs:change_plan] rpc', error);
      return { success: false, error: rpcErrorMessage(error) };
    }

    revalidateOrgSubs(orgId);
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[admin:subs:change_plan] unexpected', error);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function extendTrialAction(
  orgId: string,
  input: ExtendTrialInput
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = ExtendTrialSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    await requirePlatformAdminRole(['owner', 'billing']);
    const supabase = await createClient();
    const { ip, ua } = await getRequestMeta();

    const { subscriptionId, days } = parsed.data;

    const { error } = await supabase.rpc('admin_extend_trial', {
      p_subscription_id: subscriptionId,
      p_days:            days,
      p_ip_address:      ip,
      p_user_agent:      ua,
    });

    if (error) {
      console.error('[admin:subs:extend_trial] rpc', error);
      return { success: false, error: rpcErrorMessage(error) };
    }

    revalidateOrgSubs(orgId);
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[admin:subs:extend_trial] unexpected', error);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function cancelSubscriptionAction(
  orgId: string,
  input: CancelSubscriptionInput
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = CancelSubscriptionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    await requirePlatformAdminRole(['owner', 'billing']);
    const supabase = await createClient();
    const { ip, ua } = await getRequestMeta();

    const { subscriptionId, effectiveAt } = parsed.data;

    const { error } = await supabase.rpc('admin_cancel_subscription', {
      p_subscription_id: subscriptionId,
      p_effective_at:    effectiveAt ?? new Date().toISOString(),
      p_ip_address:      ip,
      p_user_agent:      ua,
    });

    if (error) {
      console.error('[admin:subs:cancel] rpc', error);
      return { success: false, error: rpcErrorMessage(error) };
    }

    revalidateOrgSubs(orgId);
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[admin:subs:cancel] unexpected', error);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function reactivateSubscriptionAction(
  orgId: string,
  input: ReactivateSubscriptionInput
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = ReactivateSubscriptionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    await requirePlatformAdminRole(['owner', 'billing']);
    const supabase = await createClient();
    const { ip, ua } = await getRequestMeta();

    const { subscriptionId, newPlanId } = parsed.data;

    const { error } = await supabase.rpc('admin_reactivate_subscription', {
      p_subscription_id: subscriptionId,
      p_new_plan_id:     newPlanId,
      p_ip_address:      ip,
      p_user_agent:      ua,
    });

    if (error) {
      console.error('[admin:subs:reactivate] rpc', error);
      return { success: false, error: rpcErrorMessage(error) };
    }

    revalidateOrgSubs(orgId);
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[admin:subs:reactivate] unexpected', error);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function markPastDueAction(
  orgId: string,
  input: MarkPastDueInput
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = MarkPastDueSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    // Autorização verificada em TypeScript antes de usar service client
    await requirePlatformAdminRole(['owner', 'billing']);
    const { ip, ua } = await getRequestMeta();

    // Service client necessário pois subscriptions não tem policy UPDATE
    // (writes diretos só via service_role; mutações com lógica via RPCs SECURITY DEFINER)
    const serviceClient = createServiceClient();

    const { error: updateError } = await serviceClient
      .from('subscriptions')
      .update({ status: 'past_due', updated_at: new Date().toISOString() })
      .eq('id', parsed.data.subscriptionId)
      .in('status', ['trial', 'ativa']); // só flipa de estado ativo

    if (updateError) {
      console.error('[admin:subs:mark_past_due] update', updateError);
      return { success: false, error: 'Não foi possível marcar como inadimplente.' };
    }

    // Audit via auth client (captura auth.uid() do platform admin)
    const supabase = await createClient();
    await supabase.rpc('audit_write', {
      action:                'subscription.mark_past_due',
      target_type:           'subscription',
      target_id:             parsed.data.subscriptionId,
      target_organization_id: orgId,
      diff_before:           null,
      diff_after:            null,
      metadata:              null,
      ip_address:            ip,
      user_agent:            ua,
    });

    revalidateOrgSubs(orgId);
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[admin:subs:mark_past_due] unexpected', error);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}
