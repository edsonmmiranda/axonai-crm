import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __mockSupabase } from '../setup';

// next/headers: estende o mock do setup com `headers`
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), getAll: vi.fn(() => []) })),
  headers: vi.fn(() => ({ get: vi.fn().mockReturnValue(null) })),
}));

// Mock de platformAdmin — controlado por cada teste
vi.mock('@/lib/auth/platformAdmin', () => ({
  requirePlatformAdmin:     vi.fn(),
  requirePlatformAdminRole: vi.fn(),
}));

import {
  getPlansAction,
  getPlanDetailAction,
  createPlanAction,
  updatePlanAction,
  archivePlanAction,
  deletePlanAction,
} from '@/lib/actions/admin/plans';
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

const PLAN_ID = '00000000-0000-4000-8000-000000000001';
const NEW_ID  = '00000000-0000-4000-8000-000000000099';

const MOCK_PLAN = {
  id: PLAN_ID, name: 'Básico', description: 'Plano básico',
  price_monthly_cents: 4900, price_yearly_cents: 49000,
  is_public: true, is_archived: false,
  max_users: 5, max_leads: 500, max_products: 50,
  max_pipelines: 3, max_active_integrations: 2,
  max_storage_mb: 1024, allow_ai_features: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const VALID_CREATE = {
  name: 'Plano Pro', priceMonthly: 9900, priceYearly: 99000,
  isPublic: true, featuresJsonb: ['Até 20 usuários'],
  allowAiFeatures: false,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeListMock(result: { data: unknown[]; error: null | object; count: number }) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select', 'eq', 'in', 'ilike', 'or', 'order', 'limit']) {
    q[m] = vi.fn().mockReturnValue(q);
  }
  q.range      = vi.fn().mockResolvedValue(result);
  q.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  return q;
}

function makeSingleMock(data: unknown) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
    q[m] = vi.fn().mockReturnValue(q);
  }
  q.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  return q;
}

// ─── Reset antes de cada teste ────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(requirePlatformAdmin).mockReset();
  vi.mocked(requirePlatformAdmin).mockResolvedValue(FAKE_ADMIN);
  vi.mocked(requirePlatformAdminRole).mockReset();
  vi.mocked(requirePlatformAdminRole).mockResolvedValue(FAKE_ADMIN);
});

// ─── getPlansAction ───────────────────────────────────────────────────────────

describe('getPlansAction', () => {
  it('happy path — retorna lista paginada com activeSubscriptionsCount', async () => {
    __mockSupabase.from
      .mockReturnValueOnce(makeListMock({ data: [MOCK_PLAN], error: null, count: 1 }))
      .mockReturnValueOnce(makeListMock({ data: [{ plan_id: PLAN_ID }], error: null, count: 1 }));

    const result = await getPlansAction({ page: 1, pageSize: 25 });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].name).toBe('Básico');
    expect(result.metadata?.total).toBe(1);
  });

  it('Zod — pageSize inválido retorna success: false sem chamar Supabase', async () => {
    const result = await getPlansAction({ pageSize: 9999 } as never);
    expect(result.success).toBe(false);
    expect(__mockSupabase.from).not.toHaveBeenCalled();
  });

  it('auth — sem platform admin retorna success: false', async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValueOnce(new Error('not found'));
    const result = await getPlansAction();
    expect(result.success).toBe(false);
  });

  it('erro de banco retorna success: false', async () => {
    __mockSupabase.from.mockReturnValueOnce(
      makeListMock({ data: [], error: { message: 'db error' }, count: 0 })
    );
    const result = await getPlansAction();
    expect(result.success).toBe(false);
    expect(result.error).not.toContain('db error');
  });
});

// ─── getPlanDetailAction ──────────────────────────────────────────────────────

describe('getPlanDetailAction', () => {
  it('happy path — retorna plano com activeSubscriptionsCount', async () => {
    __mockSupabase.from
      .mockReturnValueOnce(makeSingleMock(MOCK_PLAN))
      .mockReturnValueOnce(makeListMock({ data: [], error: null, count: 3 }));

    const result = await getPlanDetailAction(PLAN_ID);

    expect(result.success).toBe(true);
    expect(result.data?.name).toBe('Básico');
    expect(result.data?.priceMonthly).toBe(4900);
  });

  it('ID UUID inválido retorna success: false sem chamar Supabase', async () => {
    const result = await getPlanDetailAction('not-a-uuid');
    expect(result.success).toBe(false);
    expect(__mockSupabase.from).not.toHaveBeenCalled();
  });

  it('auth — sem platform admin retorna success: false', async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValueOnce(new Error('not found'));
    const result = await getPlanDetailAction(PLAN_ID);
    expect(result.success).toBe(false);
  });

  it('plano não encontrado → success: false com mensagem clara', async () => {
    __mockSupabase.from.mockReturnValueOnce(makeSingleMock(null));
    const result = await getPlanDetailAction(PLAN_ID);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Plano não encontrado.');
  });
});

// ─── createPlanAction ─────────────────────────────────────────────────────────

describe('createPlanAction', () => {
  it('happy path — chama RPC e retorna id', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: NEW_ID, error: null });

    const result = await createPlanAction(VALID_CREATE);

    expect(result.success).toBe(true);
    expect(result.data?.id).toBe(NEW_ID);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith(
      'admin_create_plan',
      expect.objectContaining({ p_name: 'Plano Pro', p_price_monthly_cents: 9900 })
    );
  });

  it('Zod — nome muito curto retorna success: false sem chamar RPC', async () => {
    const result = await createPlanAction({ ...VALID_CREATE, name: 'X' });
    expect(result.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('Zod — priceMonthly negativo retorna success: false sem chamar RPC', async () => {
    const result = await createPlanAction({ ...VALID_CREATE, priceMonthly: -1 });
    expect(result.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('auth — role support não pode criar plano (requirePlatformAdminRole rejeita)', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValueOnce(new Error('not found'));
    const result = await createPlanAction(VALID_CREATE);
    expect(result.success).toBe(false);
  });

  // PRD §3.1 — plan_name_taken: nome duplicado → mensagem pt-BR
  it('[PRD §3.1] RPC plan_name_taken → mensagem menciona "nome"', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('plan_name_taken') });
    const result = await createPlanAction(VALID_CREATE);
    expect(result.success).toBe(false);
    expect(result.error).toContain('nome');
    expect(result.error).not.toContain('plan_name_taken');
  });

  // price = 0 é válido (plano gratuito)
  it('[PRD §6] priceMonthly = 0 (plano gratuito) é válido', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: NEW_ID, error: null });
    const result = await createPlanAction({ ...VALID_CREATE, priceMonthly: 0, priceYearly: 0 });
    expect(result.success).toBe(true);
  });
});

// ─── updatePlanAction ─────────────────────────────────────────────────────────

describe('updatePlanAction', () => {
  const VALID_UPDATE = { id: PLAN_ID, ...VALID_CREATE, name: 'Plano Pro Plus' };

  it('happy path — chama RPC e retorna ok: true', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await updatePlanAction(VALID_UPDATE);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ok: true });
    expect(__mockSupabase.rpc).toHaveBeenCalledWith(
      'admin_update_plan',
      expect.objectContaining({ p_plan_id: PLAN_ID, p_name: 'Plano Pro Plus' })
    );
  });

  it('Zod — id UUID inválido retorna success: false sem chamar RPC', async () => {
    const result = await updatePlanAction({ ...VALID_UPDATE, id: 'not-uuid' });
    expect(result.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('auth — role billing não pode editar plano', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValueOnce(new Error('not found'));
    const result = await updatePlanAction(VALID_UPDATE);
    expect(result.success).toBe(false);
  });

  // PRD §3.1 — plan_archived: plano já arquivado não pode ser editado
  it('[PRD §3.1] RPC plan_archived → mensagem menciona "arquivado"', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('plan_archived') });
    const result = await updatePlanAction(VALID_UPDATE);
    expect(result.success).toBe(false);
    expect(result.error).toContain('arquivado');
  });
});

// ─── archivePlanAction ────────────────────────────────────────────────────────

describe('archivePlanAction', () => {
  it('happy path — chama RPC e retorna ok: true', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await archivePlanAction({ id: PLAN_ID });

    expect(result.success).toBe(true);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith(
      'admin_archive_plan',
      expect.objectContaining({ p_plan_id: PLAN_ID })
    );
  });

  it('Zod — UUID inválido retorna success: false sem chamar RPC', async () => {
    const result = await archivePlanAction({ id: 'bad-id' });
    expect(result.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('auth — sem owner retorna success: false', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValueOnce(new Error('not found'));
    const result = await archivePlanAction({ id: PLAN_ID });
    expect(result.success).toBe(false);
  });

  it('RPC plan_not_found → mensagem correta', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('plan_not_found') });
    const result = await archivePlanAction({ id: PLAN_ID });
    expect(result.success).toBe(false);
    expect(result.error).toContain('encontrado');
  });
});

// ─── deletePlanAction ─────────────────────────────────────────────────────────

describe('deletePlanAction', () => {
  it('happy path — chama RPC e retorna ok: true', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await deletePlanAction({ id: PLAN_ID });

    expect(result.success).toBe(true);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith(
      'admin_delete_plan',
      expect.objectContaining({ p_plan_id: PLAN_ID })
    );
  });

  it('Zod — UUID inválido retorna success: false sem chamar RPC', async () => {
    const result = await deletePlanAction({ id: 'bad' });
    expect(result.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('auth — billing não pode excluir plano', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValueOnce(new Error('not found'));
    const result = await deletePlanAction({ id: PLAN_ID });
    expect(result.success).toBe(false);
  });

  // PRD §6 [INV-2] — plano em uso não pode ser excluído
  it('[PRD INV-2] RPC plan_in_use → mensagem menciona "subscriptions ativas"', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('plan_in_use') });
    const result = await deletePlanAction({ id: PLAN_ID });
    expect(result.success).toBe(false);
    expect(result.error).toContain('subscriptions ativas');
    expect(result.error).not.toContain('plan_in_use');
  });
});
