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

import { getPlatformSettingsAction, updatePlatformSettingAction } from '@/lib/actions/admin/platform-settings';
import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';

const FAKE_ADMIN = { id: 'a', profileId: 'test-user-id', role: 'owner' as const, isActive: true, createdAt: '', email: '' };

function makeFromMock(data: unknown, error: unknown = null) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select','eq','order','maybeSingle','single']) q[m] = vi.fn().mockReturnValue(q);
  q.order = vi.fn().mockResolvedValue({ data, error });
  q.single = vi.fn().mockResolvedValue({ data: Array.isArray(data) ? data[0] : data, error });
  q.maybeSingle = vi.fn().mockResolvedValue({ data: Array.isArray(data) ? data[0] : data, error });
  return q;
}

beforeEach(() => {
  vi.mocked(requirePlatformAdmin).mockReset().mockResolvedValue(FAKE_ADMIN);
  vi.mocked(requirePlatformAdminRole).mockReset().mockResolvedValue(FAKE_ADMIN);
  __mockSupabase.rpc.mockReset();
  __mockSupabase.from.mockReset();
});

// ── getPlatformSettingsAction ─────────────────────────────────────────────────

describe('getPlatformSettingsAction', () => {
  it('happy path — retorna lista de settings mapeadas', async () => {
    const rows = [
      { key: 'trial_default_days', value_type: 'int', value_int: 14, value_text: null, value_bool: null, value_jsonb: null, description: 'Dias de trial', updated_at: '2026-01-01T00:00:00Z', updated_by: null },
    ];
    __mockSupabase.from.mockReturnValue(makeFromMock(rows));
    const result = await getPlatformSettingsAction();
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].key).toBe('trial_default_days');
    expect(result.data![0].value).toEqual({ type: 'int', value: 14 });
  });

  it('auth fail — requirePlatformAdmin throws → success: false', async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValue(new Error('Unauthorized'));
    const result = await getPlatformSettingsAction();
    expect(result.success).toBe(false);
  });

  it('supabase error → success: false com mensagem amigável', async () => {
    const q = makeFromMock(null, { message: 'db error' });
    q.order = vi.fn().mockResolvedValue({ data: null, error: { message: 'db error' } });
    __mockSupabase.from.mockReturnValue(q);
    const result = await getPlatformSettingsAction();
    expect(result.success).toBe(false);
    expect(result.error).not.toContain('db error'); // nunca expõe mensagem interna
  });

  it('suporte e billing podem ler (requirePlatformAdmin chamado, não requirePlatformAdminRole)', async () => {
    __mockSupabase.from.mockReturnValue(makeFromMock([]));
    await getPlatformSettingsAction();
    expect(vi.mocked(requirePlatformAdmin)).toHaveBeenCalled();
    expect(vi.mocked(requirePlatformAdminRole)).not.toHaveBeenCalled();
  });
});

// ── updatePlatformSettingAction ───────────────────────────────────────────────

describe('updatePlatformSettingAction', () => {
  it('happy path int — chama RPC e revalida paths', async () => {
    __mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
    const result = await updatePlatformSettingAction({ key: 'trial_default_days', valueType: 'int', value: 30 });
    expect(result.success).toBe(true);
    expect(result.data?.key).toBe('trial_default_days');
    expect(__mockSupabase.rpc).toHaveBeenCalledWith('admin_set_setting', expect.objectContaining({ p_key: 'trial_default_days', p_value_type: 'int', p_value_int: 30 }));
  });

  it('happy path bool — campo value_bool preenchido, demais nulos', async () => {
    __mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
    const result = await updatePlatformSettingAction({ key: 'signup_link_offline_fallback_enabled', valueType: 'bool', value: false });
    expect(result.success).toBe(true);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith('admin_set_setting', expect.objectContaining({ p_value_bool: false, p_value_int: null, p_value_text: null, p_value_jsonb: null }));
  });

  it('Zod fail — valueType=int mas value="abc" → success: false sem chamar Supabase (PRD §3-update-1)', async () => {
    const result = await updatePlatformSettingAction({ key: 'trial_default_days', valueType: 'int', value: 'abc' as unknown as number });
    expect(result.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('RBAC — role support não pode alterar (requirePlatformAdminRole lança) (PRD §3-update-2)', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValue(new Error('Acesso negado'));
    const result = await updatePlatformSettingAction({ key: 'trial_default_days', valueType: 'int', value: 7 });
    expect(result.success).toBe(false);
  });

  it('setting inexistente é criada via UPSERT — RPC chamada normalmente (PRD §3-update-3)', async () => {
    __mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
    const result = await updatePlatformSettingAction({ key: 'new_custom_setting', valueType: 'text', value: 'hello' });
    expect(result.success).toBe(true);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith('admin_set_setting', expect.objectContaining({ p_key: 'new_custom_setting', p_value_text: 'hello' }));
  });

  it('RPC retorna erro unauthorized → mensagem amigável em pt-BR', async () => {
    __mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'unauthorized' } });
    const result = await updatePlatformSettingAction({ key: 'trial_default_days', valueType: 'int', value: 7 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('owner');
  });
});
