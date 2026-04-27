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

import { getDashboardMetricsAction, refreshDashboardMetricsAction } from '@/lib/actions/admin/platform-metrics';
import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';

const FAKE_ADMIN = { id: 'a', profileId: 'test-user-id', role: 'owner' as const, isActive: true, createdAt: '', email: '' };

const FRESH_SNAPSHOT = {
  id: 1,
  active_orgs_count: 10,
  active_users_count: 42,
  leads_total: 1500,
  refreshed_at: new Date().toISOString(), // now — fresco
  refreshed_by: null,
};

const STALE_SNAPSHOT = {
  ...FRESH_SNAPSHOT,
  refreshed_at: '1970-01-01T00:00:00Z', // stale
};

function makeSingleMock(data: unknown, error: unknown = null) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select','eq','single']) q[m] = vi.fn().mockReturnValue(q);
  q.single = vi.fn().mockResolvedValue({ data, error });
  return q;
}

beforeEach(() => {
  vi.mocked(requirePlatformAdmin).mockReset().mockResolvedValue(FAKE_ADMIN);
  vi.mocked(requirePlatformAdminRole).mockReset().mockResolvedValue(FAKE_ADMIN);
  __mockSupabase.rpc.mockReset();
  __mockSupabase.from.mockReset();
});

// ── getDashboardMetricsAction ─────────────────────────────────────────────────

describe('getDashboardMetricsAction', () => {
  it('happy path — snapshot fresco retornado sem lazy refresh', async () => {
    __mockSupabase.from.mockReturnValue(makeSingleMock(FRESH_SNAPSHOT));
    const result = await getDashboardMetricsAction();
    expect(result.success).toBe(true);
    expect(result.data?.activeOrgsCount).toBe(10);
    expect(result.data?.isStaleAfterFetch).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled(); // não dispara refresh
  });

  it('snapshot stale — dispara lazy refresh e retorna valores atualizados', async () => {
    __mockSupabase.from.mockReturnValue(makeSingleMock(STALE_SNAPSHOT));
    __mockSupabase.rpc.mockResolvedValue({
      data: [{ ...FRESH_SNAPSHOT, active_orgs_count: 15 }],
      error: null,
    });
    const result = await getDashboardMetricsAction();
    expect(result.success).toBe(true);
    expect(result.data?.activeOrgsCount).toBe(15);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith('refresh_platform_metrics', expect.any(Object));
  });

  it('lazy refresh falha (billing sem permissão) — retorna snapshot stale com isStaleAfterFetch=true', async () => {
    __mockSupabase.from.mockReturnValue(makeSingleMock(STALE_SNAPSHOT));
    __mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'unauthorized' } });
    const result = await getDashboardMetricsAction();
    expect(result.success).toBe(true);
    expect(result.data?.isStaleAfterFetch).toBe(true);
    expect(result.data?.leadsTotal).toBe(1500); // snapshot antigo
  });

  it('auth fail → success: false', async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValue(new Error('Unauthorized'));
    const result = await getDashboardMetricsAction();
    expect(result.success).toBe(false);
  });

  it('snapshot ausente (anomalia) → success: false', async () => {
    __mockSupabase.from.mockReturnValue(makeSingleMock(null, { message: 'no rows' }));
    const result = await getDashboardMetricsAction();
    expect(result.success).toBe(false);
  });
});

// ── refreshDashboardMetricsAction ────────────────────────────────────────────

describe('refreshDashboardMetricsAction', () => {
  it('happy path owner — chama RPC e retorna dados atualizados', async () => {
    __mockSupabase.rpc.mockResolvedValue({ data: [FRESH_SNAPSHOT], error: null });
    const result = await refreshDashboardMetricsAction();
    expect(result.success).toBe(true);
    expect(result.data?.activeOrgsCount).toBe(10);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith('refresh_platform_metrics', expect.any(Object));
  });

  it('RBAC — billing não pode disparar refresh manual (requirePlatformAdminRole lança)', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValue(new Error('Acesso negado'));
    const result = await refreshDashboardMetricsAction();
    expect(result.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });
});
