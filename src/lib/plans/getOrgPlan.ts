import 'server-only';

import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';

export type SubscriptionStatus =
  | 'trial'
  | 'ativa'
  | 'past_due'
  | 'trial_expired'
  | 'cancelada'
  | 'suspensa';

export interface PlanLimits {
  maxUsers: number | null;
  maxLeads: number | null;
  maxProducts: number | null;
  maxPipelines: number | null;
  maxActiveIntegrations: number | null;
  maxStorageMb: number | null;
  allowAiFeatures: boolean;
}

export interface OrgPlanSnapshot {
  subscriptionId: string;
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  periodStart: string;
  periodEnd: string | null;
  limits: PlanLimits;
}

interface RpcRow {
  subscription_id: string;
  organization_id: string;
  plan_id: string;
  plan_name: string;
  status: SubscriptionStatus;
  period_start: string;
  period_end: string | null;
  metadata: Record<string, unknown>;
  max_users: number | null;
  max_leads: number | null;
  max_products: number | null;
  max_pipelines: number | null;
  max_active_integrations: number | null;
  max_storage_mb: number | null;
  allow_ai_features: boolean;
}

export const getOrgPlan = cache(
  async (orgId: string): Promise<OrgPlanSnapshot> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_current_subscription', {
      p_org_id: orgId,
    });

    if (error) {
      if (error.code === '42501') {
        throw new Error('org_plan_forbidden');
      }
      if (error.code === 'P0002') {
        throw new Error('org_plan_missing');
      }
      console.error('[plans:getOrgPlan] rpc failed', error);
      throw new Error('org_plan_network_error');
    }

    const rows = data as RpcRow[] | null;
    if (!rows || rows.length === 0) {
      throw new Error('org_plan_missing');
    }

    const row = rows[0];
    return {
      subscriptionId: row.subscription_id,
      planId: row.plan_id,
      planName: row.plan_name,
      status: row.status,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      limits: {
        maxUsers: row.max_users,
        maxLeads: row.max_leads,
        maxProducts: row.max_products,
        maxPipelines: row.max_pipelines,
        maxActiveIntegrations: row.max_active_integrations,
        maxStorageMb: row.max_storage_mb,
        allowAiFeatures: row.allow_ai_features,
      },
    };
  }
);
