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

import { getFeatureFlagsAction, setFeatureFlagAction } from '@/lib/actions/admin/feature-flags';
import { FEATURE_FLAG_REGISTRY } from '@/lib/featureFlags/registry';
import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';

const FAKE_ADMIN = { id: 'a', profileId: 'test-user-id', role: 'owner' as const, isActive: true, createdAt: '', email: '' };

function makeFromMock(data: unknown, error: unknown = null) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select','order']) q[m] = vi.fn().mockReturnValue(q);
  q.order = vi.fn().mockResolvedValue({ data, error });
  return q;
}

beforeEach(() => {
  vi.mocked(requirePlatformAdmin).mockReset().mockResolvedValue(FAKE_ADMIN);
  vi.mocked(requirePlatformAdminRole).mockReset().mockResolvedValue(FAKE_ADMIN);
  __mockSupabase.rpc.mockReset();
  __mockSupabase.from.mockReset();
});

// ── getFeatureFlagsAction ─────────────────────────────────────────────────────

describe('getFeatureFlagsAction', () => {
  it('happy path — lista mescla registry + rows persistidos', async () => {
    const persistedRows = [
      { key: 'enable_public_signup', enabled: true, config: {}, updated_at: '2026-01-01', updated_by: null },
    ];
    __mockSupabase.from.mockReturnValue(makeFromMock(persistedRows));
    const result = await getFeatureFlagsAction();
    expect(result.success).toBe(true);
    const signup = result.data!.find(f => f.key === 'enable_public_signup');
    expect(signup?.enabled).toBe(true);
    expect(signup?.isInitialized).toBe(true);
  });

  it('flag não inicializada — usa defaultEnabled do registry e isInitialized=false', async () => {
    __mockSupabase.from.mockReturnValue(makeFromMock([]));
    const result = await getFeatureFlagsAction();
    expect(result.success).toBe(true);
    for (const spec of FEATURE_FLAG_REGISTRY) {
      const flag = result.data!.find(f => f.key === spec.key);
      expect(flag?.isInitialized).toBe(false);
      expect(flag?.enabled).toBe(spec.defaultEnabled);
    }
  });

  it('retorna exatamente as flags do registry (sem flags estranhas)', async () => {
    __mockSupabase.from.mockReturnValue(makeFromMock([
      { key: 'unknown_key', enabled: true, config: {}, updated_at: '', updated_by: null },
    ]));
    const result = await getFeatureFlagsAction();
    const keys = result.data!.map(f => f.key);
    expect(keys).not.toContain('unknown_key');
  });

  it('auth fail → success: false', async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValue(new Error('Unauthorized'));
    const result = await getFeatureFlagsAction();
    expect(result.success).toBe(false);
  });
});

// ── setFeatureFlagAction ──────────────────────────────────────────────────────

describe('setFeatureFlagAction', () => {
  it('happy path — chama RPC e revalida path', async () => {
    __mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
    const result = await setFeatureFlagAction({ key: 'enable_public_signup', enabled: true });
    expect(result.success).toBe(true);
    expect(result.data?.enabled).toBe(true);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith('admin_set_feature_flag', expect.objectContaining({ p_key: 'enable_public_signup', p_enabled: true }));
  });

  it('Zod fail — key fora do registry → success: false sem chamar RPC', async () => {
    const result = await setFeatureFlagAction({ key: 'totally_unknown_flag', enabled: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain('não registrada');
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('RBAC — support/billing não podem alterar flags (requirePlatformAdminRole lança)', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValue(new Error('Acesso negado'));
    const result = await setFeatureFlagAction({ key: 'enable_public_signup', enabled: false });
    expect(result.success).toBe(false);
  });

  it('RPC retorna feature_flag_key_not_registered (drift banco-TS) → mensagem amigável', async () => {
    __mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'feature_flag_key_not_registered' } });
    const result = await setFeatureFlagAction({ key: 'enable_ai_summarization', enabled: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain('não registrada');
  });

  it('RPC retorna unauthorized → mensagem amigável em pt-BR', async () => {
    __mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'unauthorized' } });
    const result = await setFeatureFlagAction({ key: 'enable_public_signup', enabled: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain('owner');
  });
});
