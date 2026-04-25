import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __mockSupabase } from '../setup';

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), getAll: vi.fn(() => []) })),
  headers: vi.fn(() => ({ get: vi.fn().mockReturnValue(null) })),
}));

vi.mock('@/lib/auth/platformAdmin', () => ({
  requirePlatformAdmin:     vi.fn(),
  requirePlatformAdminRole: vi.fn(),
}));

// Mock do service client usado por markPastDueAction
const __mockServiceQuery = {
  update:      vi.fn(),
  eq:          vi.fn(),
  in:          vi.fn(),
};
__mockServiceQuery.update.mockReturnValue(__mockServiceQuery);
__mockServiceQuery.eq.mockReturnValue(__mockServiceQuery);
__mockServiceQuery.in.mockResolvedValue({ error: null });

const __mockServiceClient = {
  from: vi.fn().mockReturnValue(__mockServiceQuery),
};

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => __mockServiceClient),
}));

import {
  getOrgSubscriptionAction,
  changePlanAction,
  extendTrialAction,
  cancelSubscriptionAction,
  reactivateSubscriptionAction,
  markPastDueAction,
} from '@/lib/actions/admin/subscriptions';
import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';

// ─── Constantes ───────────────────────────────────────────────────────────────

const FAKE_ADMIN = {
  id: 'admin-id',
  profileId: 'test-user-id',
  role: 'owner' as const,
  isActive: true,
  createdAt: new Date().toISOString(),
  email: 'admin@axon.ai',
};

const ORG_ID  = '00000000-0000-4000-8000-000000000001';
const SUB_ID  = '00000000-0000-4000-8000-000000000002';
const PLAN_ID = '00000000-0000-4000-8000-000000000003';

const MOCK_SUB_ROW = {
  subscription_id: SUB_ID,
  status: 'trial',
  plan_id: PLAN_ID,
  plan_name: 'Básico',
  period_start: new Date().toISOString(),
  period_end: new Date(Date.now() + 14 * 86400000).toISOString(),
  metadata: { trial_days_override: 14 },
  max_users: 5, max_leads: 500, max_products: 50,
  max_pipelines: 3, max_active_integrations: 2,
  max_storage_mb: 1024, allow_ai_features: false,
};

// ─── Reset antes de cada teste ────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(requirePlatformAdmin).mockReset();
  vi.mocked(requirePlatformAdmin).mockResolvedValue(FAKE_ADMIN);
  vi.mocked(requirePlatformAdminRole).mockReset();
  vi.mocked(requirePlatformAdminRole).mockResolvedValue(FAKE_ADMIN);
  // Reset service query mock
  __mockServiceQuery.in.mockResolvedValue({ error: null });
});

// ─── getOrgSubscriptionAction ─────────────────────────────────────────────────

describe('getOrgSubscriptionAction', () => {
  it('happy path — retorna OrgSubscriptionDetail via get_current_subscription', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: [MOCK_SUB_ROW], error: null });

    const result = await getOrgSubscriptionAction(ORG_ID);

    expect(result.success).toBe(true);
    expect(result.data?.subscriptionId).toBe(SUB_ID);
    expect(result.data?.status).toBe('trial');
    expect(result.data?.limits.maxUsers).toBe(5);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith(
      'get_current_subscription',
      { p_org_id: ORG_ID }
    );
  });

  it('ID UUID inválido retorna success: false sem chamar RPC', async () => {
    const result = await getOrgSubscriptionAction('not-uuid');
    expect(result.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('auth — sem platform admin retorna success: false', async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValueOnce(new Error('not found'));
    const result = await getOrgSubscriptionAction(ORG_ID);
    expect(result.success).toBe(false);
  });

  it('RPC sem dados → success: false com mensagem "Nenhuma subscription ativa"', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });
    const result = await getOrgSubscriptionAction(ORG_ID);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Nenhuma subscription ativa');
  });
});

// ─── changePlanAction ─────────────────────────────────────────────────────────

describe('changePlanAction', () => {
  const VALID_INPUT = { subscriptionId: SUB_ID, newPlanId: PLAN_ID };

  it('happy path — chama RPC admin_change_plan', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await changePlanAction(ORG_ID, VALID_INPUT);

    expect(result.success).toBe(true);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith(
      'admin_change_plan',
      expect.objectContaining({ p_subscription_id: SUB_ID, p_new_plan_id: PLAN_ID })
    );
  });

  it('Zod — newPlanId UUID inválido retorna success: false sem chamar RPC', async () => {
    const result = await changePlanAction(ORG_ID, { subscriptionId: SUB_ID, newPlanId: 'bad' });
    expect(result.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('auth — support não pode trocar plano', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValueOnce(new Error('not found'));
    const result = await changePlanAction(ORG_ID, VALID_INPUT);
    expect(result.success).toBe(false);
  });

  // PRD §6 — downgrade com usuários acima do limite
  it('[PRD RF-SUB-4] RPC downgrade_users_exceed → mensagem menciona "usuários"', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('downgrade_users_exceed') });
    const result = await changePlanAction(ORG_ID, VALID_INPUT);
    expect(result.success).toBe(false);
    expect(result.error).toContain('usuários');
    expect(result.error).not.toContain('downgrade_users_exceed');
  });

  // PRD §6 — plano não encontrado
  it('[PRD §3.4] RPC plan_not_found → mensagem correta', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('plan_not_found') });
    const result = await changePlanAction(ORG_ID, VALID_INPUT);
    expect(result.success).toBe(false);
    expect(result.error).toContain('encontrado');
  });
});

// ─── extendTrialAction ────────────────────────────────────────────────────────

describe('extendTrialAction', () => {
  const VALID_INPUT = { subscriptionId: SUB_ID, days: 7 };

  it('happy path — chama RPC admin_extend_trial', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await extendTrialAction(ORG_ID, VALID_INPUT);

    expect(result.success).toBe(true);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith(
      'admin_extend_trial',
      expect.objectContaining({ p_subscription_id: SUB_ID, p_days: 7 })
    );
  });

  it('Zod — days = 0 inválido retorna success: false sem chamar RPC', async () => {
    const result = await extendTrialAction(ORG_ID, { subscriptionId: SUB_ID, days: 0 });
    expect(result.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('Zod — days > 365 inválido retorna success: false sem chamar RPC', async () => {
    const result = await extendTrialAction(ORG_ID, { subscriptionId: SUB_ID, days: 400 });
    expect(result.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('auth — support não pode estender trial', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValueOnce(new Error('not found'));
    const result = await extendTrialAction(ORG_ID, VALID_INPUT);
    expect(result.success).toBe(false);
  });

  // PRD §6 [INV-8] — trial não pode ser reiniciado; extensão só em status trial
  it('[PRD INV-8] RPC not_in_trial → mensagem menciona "trial"', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('not_in_trial') });
    const result = await extendTrialAction(ORG_ID, VALID_INPUT);
    expect(result.success).toBe(false);
    expect(result.error).toContain('trial');
    expect(result.error).not.toContain('not_in_trial');
  });
});

// ─── cancelSubscriptionAction ─────────────────────────────────────────────────

describe('cancelSubscriptionAction', () => {
  const VALID_INPUT = { subscriptionId: SUB_ID };

  it('happy path — chama RPC admin_cancel_subscription', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await cancelSubscriptionAction(ORG_ID, VALID_INPUT);

    expect(result.success).toBe(true);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith(
      'admin_cancel_subscription',
      expect.objectContaining({ p_subscription_id: SUB_ID })
    );
  });

  it('Zod — subscriptionId UUID inválido retorna success: false sem chamar RPC', async () => {
    const result = await cancelSubscriptionAction(ORG_ID, { subscriptionId: 'bad' });
    expect(result.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('auth — sem owner/billing retorna success: false', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValueOnce(new Error('not found'));
    const result = await cancelSubscriptionAction(ORG_ID, VALID_INPUT);
    expect(result.success).toBe(false);
  });

  it('[PRD §6] RPC already_cancelled → mensagem menciona "cancelada"', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('already_cancelled') });
    const result = await cancelSubscriptionAction(ORG_ID, VALID_INPUT);
    expect(result.success).toBe(false);
    expect(result.error).toContain('cancelada');
  });
});

// ─── reactivateSubscriptionAction ─────────────────────────────────────────────

describe('reactivateSubscriptionAction', () => {
  const VALID_INPUT = { subscriptionId: SUB_ID, newPlanId: PLAN_ID };

  it('happy path — chama RPC admin_reactivate_subscription', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await reactivateSubscriptionAction(ORG_ID, VALID_INPUT);

    expect(result.success).toBe(true);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith(
      'admin_reactivate_subscription',
      expect.objectContaining({ p_subscription_id: SUB_ID, p_new_plan_id: PLAN_ID })
    );
  });

  it('Zod — newPlanId UUID inválido retorna success: false sem chamar RPC', async () => {
    const result = await reactivateSubscriptionAction(ORG_ID, { subscriptionId: SUB_ID, newPlanId: 'bad' });
    expect(result.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('auth — sem owner/billing retorna success: false', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValueOnce(new Error('not found'));
    const result = await reactivateSubscriptionAction(ORG_ID, VALID_INPUT);
    expect(result.success).toBe(false);
  });

  // PRD §6 [INV-1] — org com subscription ativa não pode ter segunda
  it('[PRD INV-1] RPC org_already_has_active_subscription → mensagem menciona "ativa"', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('org_already_has_active_subscription') });
    const result = await reactivateSubscriptionAction(ORG_ID, VALID_INPUT);
    expect(result.success).toBe(false);
    expect(result.error).toContain('ativa');
    expect(result.error).not.toContain('org_already_has_active_subscription');
  });

  // PRD §6 — not_cancellable (status não permite reativação)
  it('[PRD §6] RPC not_cancellable → mensagem menciona "canceladas"', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('not_cancellable') });
    const result = await reactivateSubscriptionAction(ORG_ID, VALID_INPUT);
    expect(result.success).toBe(false);
    expect(result.error).toContain('canceladas');
  });
});

// ─── markPastDueAction ────────────────────────────────────────────────────────

describe('markPastDueAction', () => {
  const VALID_INPUT = { subscriptionId: SUB_ID };

  it('happy path — atualiza via service client e grava audit', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null }); // audit_write

    const result = await markPastDueAction(ORG_ID, VALID_INPUT);

    expect(result.success).toBe(true);
    expect(__mockServiceClient.from).toHaveBeenCalledWith('subscriptions');
    expect(__mockServiceQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'past_due' })
    );
  });

  it('Zod — subscriptionId UUID inválido retorna success: false sem tocar Supabase', async () => {
    const result = await markPastDueAction(ORG_ID, { subscriptionId: 'bad' });
    expect(result.success).toBe(false);
    expect(__mockServiceClient.from).not.toHaveBeenCalled();
  });

  it('auth — sem owner/billing retorna success: false sem tocar service client', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValueOnce(new Error('not found'));
    const result = await markPastDueAction(ORG_ID, VALID_INPUT);
    expect(result.success).toBe(false);
    expect(__mockServiceClient.from).not.toHaveBeenCalled();
  });
});
