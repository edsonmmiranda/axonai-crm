import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), getAll: vi.fn(() => []) })),
  headers: vi.fn(() => ({ get: vi.fn().mockReturnValue(null) })),
}));

vi.mock('@/lib/auth/platformAdmin', () => ({
  requirePlatformAdmin:     vi.fn(),
  requirePlatformAdminRole: vi.fn(),
}));

const __mockServiceClient = {
  rpc: vi.fn(),
};

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => __mockServiceClient),
}));

import { triggerLazyTransitionAction } from '@/lib/actions/admin/subscription-transitions';
import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';
import { revalidatePath } from 'next/cache';

const FAKE_ADMIN = {
  id: 'admin-id',
  profileId: 'test-user-id',
  role: 'owner' as const,
  isActive: true,
  createdAt: new Date().toISOString(),
  email: 'admin@axon.ai',
  adminTheme: 'light' as const,
};

const ORG_ID = '00000000-0000-4000-8000-000000000001';

beforeEach(() => {
  vi.mocked(requirePlatformAdmin).mockReset();
  vi.mocked(requirePlatformAdmin).mockResolvedValue(FAKE_ADMIN);
  __mockServiceClient.rpc.mockReset();
  __mockServiceClient.rpc.mockResolvedValue({
    data: {
      transitioned: 0,
      trial_expired: 0,
      past_due_blocked: 0,
      cancelada_blocked: 0,
      source: 'lazy_middleware',
      ran_at: new Date().toISOString(),
    },
    error: null,
  });
});

describe('triggerLazyTransitionAction', () => {
  // PRD §3 — happy path: RPC retorna 1 transição (trial expirado)
  it('happy path: flipa trial → trial_expired e revalida páginas da org', async () => {
    const ranAt = new Date().toISOString();
    __mockServiceClient.rpc.mockResolvedValueOnce({
      data: {
        transitioned: 1,
        trial_expired: 1,
        past_due_blocked: 0,
        cancelada_blocked: 0,
        source: 'lazy_middleware',
        ran_at: ranAt,
      },
      error: null,
    });

    const result = await triggerLazyTransitionAction({ organizationId: ORG_ID });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      transitioned: 1,
      trialExpired: 1,
      pastDueBlocked: 0,
      canceladaBlocked: 0,
      source: 'lazy_middleware',
    });
    expect(__mockServiceClient.rpc).toHaveBeenCalledWith(
      'admin_transition_subscription_for_org',
      { p_org_id: ORG_ID },
    );
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/admin/organizations/${ORG_ID}`,
      'page',
    );
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/admin/organizations/${ORG_ID}/subscription`,
      'page',
    );
  });

  // Idempotência (Sprint §Edge Cases — rerun = 0 rows, sem revalidate desnecessário)
  it('rerun no-op: 0 transitioned não dispara revalidatePath', async () => {
    __mockServiceClient.rpc.mockResolvedValueOnce({
      data: {
        transitioned: 0,
        trial_expired: 0,
        past_due_blocked: 0,
        cancelada_blocked: 0,
        source: 'lazy_middleware',
        ran_at: new Date().toISOString(),
      },
      error: null,
    });

    const result = await triggerLazyTransitionAction({ organizationId: ORG_ID });

    expect(result.success).toBe(true);
    expect(result.data?.transitioned).toBe(0);
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  // Validação Zod
  it('rejeita organizationId inválido (não-UUID) sem chamar RPC', async () => {
    const result = await triggerLazyTransitionAction({ organizationId: 'not-a-uuid' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/dados inválidos/i);
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });

  // Auth check (defesa em profundidade)
  it('rejeita admin não-platform (requirePlatformAdmin lança notFound)', async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValueOnce(
      new Error('NEXT_NOT_FOUND'),
    );

    const result = await triggerLazyTransitionAction({ organizationId: ORG_ID });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/falha ao atualizar/i);
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });

  // Admin inativo (defesa em profundidade)
  it('rejeita admin inativo (isActive=false)', async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValueOnce({
      ...FAKE_ADMIN,
      isActive: false,
    });

    const result = await triggerLazyTransitionAction({ organizationId: ORG_ID });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/permissão insuficiente/i);
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });

  // RPC error → mensagem amigável (sem vazar error.message)
  it('mapeia erro do RPC para mensagem amigável fixa', async () => {
    __mockServiceClient.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'invalid_transition_source: foo', code: 'P0001' },
    });

    const result = await triggerLazyTransitionAction({ organizationId: ORG_ID });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/falha ao atualizar status/i);
    expect(result.error).not.toContain('invalid_transition_source');
  });
});
