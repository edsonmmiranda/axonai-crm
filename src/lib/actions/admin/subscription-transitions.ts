'use server';

import { revalidatePath } from 'next/cache';

import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';
import { createServiceClient } from '@/lib/supabase/service';

import {
  TriggerLazyTransitionSchema,
  type SubscriptionTransitionResult,
  type TriggerLazyTransitionInput,
} from './subscription-transitions.schemas';

interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Lazy fallback do cron de transições de subscription (Sprint admin_13).
 *
 * Chama RPC `admin_transition_subscription_for_org(uuid)` para flipar o status
 * da org especificada se as condições de transição forem atendidas (trial vencido,
 * past_due excedido grace, cancelada com período pago vencido).
 *
 * Idempotente — rerun no mesmo segundo altera 0 linhas.
 *
 * Quem chama: middleware admin (via helper) ou Server Component admin antes de
 * renderizar dashboard de uma org. Não é UI de mutação direta.
 */
export async function triggerLazyTransitionAction(
  input: TriggerLazyTransitionInput,
): Promise<ActionResponse<SubscriptionTransitionResult>> {
  try {
    // 1) Validar input
    const parsed = TriggerLazyTransitionSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'Dados inválidos para transição de subscription.' };
    }

    // 2) Auth check + autorização (defesa em profundidade — middleware admin já
    //    validou, mas a RPC pode ser chamada de outros lugares no futuro).
    const admin = await requirePlatformAdmin();
    if (!admin.isActive) {
      return { success: false, error: 'Permissão insuficiente para esta ação.' };
    }

    // 3) Chamar RPC via service client (RPC tem GRANT só para service_role)
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('admin_transition_subscription_for_org', {
      p_org_id: parsed.data.organizationId,
    });

    if (error) {
      console.error('[triggerLazyTransitionAction] RPC error:', {
        organizationId: parsed.data.organizationId,
        message: error.message,
        code: error.code,
      });
      return { success: false, error: 'Falha ao atualizar status da assinatura.' };
    }

    const raw = data as {
      transitioned?: number;
      trial_expired?: number;
      past_due_blocked?: number;
      cancelada_blocked?: number;
      source?: string;
      ran_at?: string;
    } | null;

    const result: SubscriptionTransitionResult = {
      transitioned: raw?.transitioned ?? 0,
      trialExpired: raw?.trial_expired ?? 0,
      pastDueBlocked: raw?.past_due_blocked ?? 0,
      canceladaBlocked: raw?.cancelada_blocked ?? 0,
      source: raw?.source ?? 'lazy_middleware',
      ranAt: raw?.ran_at ?? new Date().toISOString(),
    };

    // 4) Invalidar cache da página da org (se transition flipou status, UI precisa atualizar)
    if (result.transitioned > 0) {
      revalidatePath(`/admin/organizations/${parsed.data.organizationId}`, 'page');
      revalidatePath(`/admin/organizations/${parsed.data.organizationId}/subscription`, 'page');
    }

    return { success: true, data: result };
  } catch (err) {
    console.error('[triggerLazyTransitionAction] unexpected error:', err);
    return { success: false, error: 'Falha ao atualizar status da assinatura.' };
  }
}
