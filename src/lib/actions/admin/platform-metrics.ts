'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';
import { createClient } from '@/lib/supabase/server';

import { mapMetricsRow, type DashboardMetrics } from './platform-metrics.schemas';

interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

async function getRequestMeta(): Promise<{ ip: string | null; ua: string | null }> {
  const hdrs = await headers();
  const forwarded = hdrs.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : hdrs.get('x-real-ip');
  return { ip, ua: hdrs.get('user-agent') };
}

export async function getDashboardMetricsAction(): Promise<ActionResponse<DashboardMetrics>> {
  try {
    await requirePlatformAdmin();
    const supabase = await createClient();

    const { data: snapshot, error } = await supabase
      .from('platform_metrics_snapshot')
      .select('*')
      .eq('id', 1)
      .single();

    if (error || !snapshot) {
      console.error('[admin:metrics:get]', error);
      return { success: false, error: 'Erro ao carregar métricas.' };
    }

    // Lazy refresh if stale
    const age = Date.now() - new Date(snapshot.refreshed_at as string).getTime();
    if (age > STALE_THRESHOLD_MS) {
      const { ip, ua } = await getRequestMeta();
      const { data: refreshed, error: refreshErr } = await supabase.rpc('refresh_platform_metrics', {
        p_ip_address: ip,
        p_user_agent: ua,
      });
      if (!refreshErr && refreshed?.[0]) {
        return { success: true, data: mapMetricsRow(refreshed[0]) };
      }
      // Refresh failed (ex: billing role) — return stale snapshot
      console.warn('[admin:metrics:lazy-refresh]', refreshErr);
      return { success: true, data: mapMetricsRow(snapshot, true) };
    }

    return { success: true, data: mapMetricsRow(snapshot) };
  } catch (err) {
    console.error('[admin:metrics:get]', err);
    return { success: false, error: 'Erro interno.' };
  }
}

export async function refreshDashboardMetricsAction(): Promise<ActionResponse<DashboardMetrics>> {
  try {
    await requirePlatformAdminRole(['owner', 'support']);
    const supabase = await createClient();
    const { ip, ua } = await getRequestMeta();

    const { data, error } = await supabase.rpc('refresh_platform_metrics', {
      p_ip_address: ip,
      p_user_agent: ua,
    });
    if (error) {
      console.error('[admin:metrics:refresh]', error);
      return { success: false, error: 'Erro ao atualizar métricas. Tente novamente.' };
    }

    revalidatePath('/admin/dashboard');
    return { success: true, data: mapMetricsRow(data[0]) };
  } catch (err) {
    console.error('[admin:metrics:refresh]', err);
    return { success: false, error: 'Erro interno.' };
  }
}
