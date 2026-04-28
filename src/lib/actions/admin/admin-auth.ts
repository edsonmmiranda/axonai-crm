'use server';

import 'server-only';

import { headers } from 'next/headers';

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

import {
  CompleteMfaReenrollSchema,
  CompletePasswordResetSchema,
  type CompleteMfaReenrollInput,
  type CompleteMfaReenrollResult,
  type CompletePasswordResetInput,
  type CompletePasswordResetResult,
} from './admin-auth.schemas';

interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

async function getRequestMeta(): Promise<{ ip: string | null; ua: string | null }> {
  const hdrs = await headers();
  const forwarded = hdrs.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : hdrs.get('x-real-ip');
  return { ip, ua: hdrs.get('user-agent') };
}

/**
 * Called by /admin/reset-password page after the user submits a new password.
 * Requires an active recovery session (Supabase auth.updateUser succeeds
 * only when the user is authenticated via the recovery token).
 *
 * Flow:
 *   1. supabase.auth.updateUser({ password }) — applies new password.
 *   2. mark_admin_password_reset(profile_id) — sets mfa_reset_required=true
 *      if user is platform admin (no-op for customer users).
 *   3. Redirect to /admin/login (user must re-authenticate with new password
 *      and will be forced into mfa-enroll?reenroll=true by middleware).
 */
export async function completeAdminPasswordResetAction(
  input: CompletePasswordResetInput,
): Promise<ActionResponse<CompletePasswordResetResult>> {
  const parsed = CompletePasswordResetSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Entrada inválida.' };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Sessão de recuperação inválida.' };
    }

    const { error: updateErr } = await supabase.auth.updateUser({
      password: parsed.data.newPassword,
    });
    if (updateErr) {
      console.error('[admin:auth:password-reset:update]', updateErr);
      return { success: false, error: 'Não foi possível atualizar a senha.' };
    }

    const { ip, ua } = await getRequestMeta();
    const service = createServiceClient();
    const { error: rpcErr } = await service.rpc('mark_admin_password_reset', {
      p_profile_id: user.id,
      p_ip_address: ip,
      p_user_agent: ua,
    });
    if (rpcErr) {
      console.error('[admin:auth:password-reset:rpc]', rpcErr);
      // Password já foi trocada — não falha a action; apenas reporta no log.
      // Próximo login do admin redireciona via middleware mesmo sem flag se MFA ok.
    }

    return { success: true, data: { redirectTo: '/admin/login' } };
  } catch (err) {
    console.error('[admin:auth:password-reset] unexpected', err);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

/**
 * Called by /admin/mfa-enroll?reenroll=true OR ?firstEnroll=true after the
 * user verifies a new TOTP factor in the UI.
 *
 * Flow:
 *   1. Verify the new factor server-side (defense in depth).
 *   2. Unenroll any other verified TOTP factors (invalidates old TOTP).
 *   3. If a pending approved MFA reset request exists for this admin →
 *      consume it (sets mfa_reset_required=false on profile).
 *      Otherwise → call complete_admin_mfa_reenroll (zeros the flag).
 *   4. Redirect to /admin/dashboard.
 */
export async function completeAdminMfaReenrollAction(
  input: CompleteMfaReenrollInput,
): Promise<ActionResponse<CompleteMfaReenrollResult>> {
  const parsed = CompleteMfaReenrollSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Entrada inválida.' };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Sessão inválida.' };
    }

    // 1. Verify the new factor (UI already did this; server-side is defense in depth).
    const { error: verifyErr } = await supabase.auth.mfa.verify({
      factorId:    parsed.data.factorId,
      challengeId: parsed.data.challengeId,
      code:        parsed.data.code,
    });
    if (verifyErr) {
      console.error('[admin:auth:mfa-reenroll:verify]', verifyErr);
      return { success: false, error: 'Código TOTP inválido.' };
    }

    // 2. Unenroll any OTHER verified TOTP factors.
    const { data: factorsList, error: listErr } = await supabase.auth.mfa.listFactors();
    if (listErr) {
      console.error('[admin:auth:mfa-reenroll:list-factors]', listErr);
    } else if (factorsList) {
      const oldVerified = (factorsList.totp ?? []).filter(
        (f) => f.id !== parsed.data.factorId && f.status === 'verified',
      );
      for (const old of oldVerified) {
        const { error: unenrollErr } = await supabase.auth.mfa.unenroll({
          factorId: old.id,
        });
        if (unenrollErr) {
          console.error('[admin:auth:mfa-reenroll:unenroll]', unenrollErr);
        }
      }
    }

    const { ip, ua } = await getRequestMeta();
    const service = createServiceClient();

    // 3. If there's a pending approved MFA reset request, consume it.
    //    Otherwise, just zero the flag via complete_admin_mfa_reenroll.
    const { data: pendingResetData, error: pendingErr } = await service
      .from('platform_admin_mfa_reset_requests')
      .select('id')
      .eq('target_profile_id', user.id)
      .is('consumed_at', null)
      .is('revoked_at', null)
      .not('approved_at', 'is', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle<{ id: string }>();

    if (pendingErr) {
      console.error('[admin:auth:mfa-reenroll:check-pending]', pendingErr);
    }

    if (pendingResetData?.id) {
      const { error: consumeErr } = await service.rpc('consume_admin_mfa_reset', {
        p_request_id:        pendingResetData.id,
        p_target_profile_id: user.id,
        p_ip_address:        ip,
        p_user_agent:        ua,
      });
      if (consumeErr) {
        console.error('[admin:auth:mfa-reenroll:consume-reset]', consumeErr);
        return { success: false, error: 'Não foi possível concluir o reset MFA.' };
      }
    } else {
      const { error: completeErr } = await service.rpc('complete_admin_mfa_reenroll', {
        p_profile_id: user.id,
        p_ip_address: ip,
        p_user_agent: ua,
      });
      if (completeErr) {
        console.error('[admin:auth:mfa-reenroll:complete]', completeErr);
        // RPC raises 'not_a_platform_admin' for customer users — but this action
        // is only reachable from /admin/* routes, so non-admin shouldn't hit it.
        return { success: false, error: 'Não foi possível concluir o re-enroll.' };
      }
    }

    return { success: true, data: { redirectTo: '/admin/dashboard' } };
  } catch (err) {
    console.error('[admin:auth:mfa-reenroll] unexpected', err);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}
