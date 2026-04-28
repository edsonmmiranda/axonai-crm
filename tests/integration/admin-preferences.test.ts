import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), getAll: vi.fn(() => []) })),
  headers: vi.fn(() => ({ get: vi.fn().mockReturnValue(null) })),
}));

vi.mock('@/lib/auth/platformAdmin', () => ({
  requirePlatformAdmin: vi.fn(),
}));

const { __mockServiceClient } = vi.hoisted(() => ({
  __mockServiceClient: { from: vi.fn() },
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => __mockServiceClient),
}));

import { updateAdminThemePreferenceAction } from '@/lib/actions/admin/preferences';
import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';

const FAKE_ADMIN = {
  id: 'a',
  profileId: 'test-user-id',
  role: 'owner' as const,
  isActive: true,
  createdAt: '',
  email: '',
  adminTheme: 'light' as const,
};

function makeProfilesQuery(opts: {
  selectResult?: { data: unknown; error: unknown };
  updateResult?: { error: unknown };
}) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  q.select = vi.fn().mockReturnValue(q);
  q.eq = vi.fn().mockReturnValue(q);
  q.single = vi.fn().mockResolvedValue(opts.selectResult ?? { data: { preferences: {} }, error: null });
  q.update = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue(opts.updateResult ?? { error: null }),
  });
  return q;
}

beforeEach(() => {
  vi.mocked(requirePlatformAdmin).mockReset().mockResolvedValue(FAKE_ADMIN);
  __mockServiceClient.from.mockReset();
});

describe('updateAdminThemePreferenceAction', () => {
  it('happy path — escreve preferences.adminTheme preservando keys existentes', async () => {
    const query = makeProfilesQuery({
      selectResult: {
        data: { preferences: { theme: 'dark', emailNotifications: true } },
        error: null,
      },
    });
    __mockServiceClient.from.mockReturnValue(query);

    const result = await updateAdminThemePreferenceAction({ theme: 'dark' });
    expect(result.success).toBe(true);
    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({
          theme: 'dark',
          emailNotifications: true,
          adminTheme: 'dark',
        }),
      }),
    );
  });

  it('happy path — admin sem preferences anteriores cria objeto novo', async () => {
    const query = makeProfilesQuery({
      selectResult: { data: { preferences: null }, error: null },
    });
    __mockServiceClient.from.mockReturnValue(query);

    const result = await updateAdminThemePreferenceAction({ theme: 'system' });
    expect(result.success).toBe(true);
    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({ preferences: { adminTheme: 'system' } }),
    );
  });

  it('auth fail → success: false sem tocar profiles', async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValue(new Error('Unauthorized'));
    const result = await updateAdminThemePreferenceAction({ theme: 'light' });
    expect(result.success).toBe(false);
    expect(__mockServiceClient.from).not.toHaveBeenCalled();
  });

  it('Zod fail — theme fora do enum → success: false sem chamar Supabase', async () => {
    // @ts-expect-error testando rejeição de valor inválido
    const result = await updateAdminThemePreferenceAction({ theme: 'sepia' });
    expect(result.success).toBe(false);
    expect(__mockServiceClient.from).not.toHaveBeenCalled();
  });

  it('read fail → mensagem amigável', async () => {
    const query = makeProfilesQuery({
      selectResult: { data: null, error: { message: 'db dead' } },
    });
    __mockServiceClient.from.mockReturnValue(query);

    const result = await updateAdminThemePreferenceAction({ theme: 'dark' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Não foi possível');
  });

  it('update fail → mensagem amigável', async () => {
    const query = makeProfilesQuery({
      selectResult: { data: { preferences: {} }, error: null },
      updateResult: { error: { message: 'constraint violation' } },
    });
    __mockServiceClient.from.mockReturnValue(query);

    const result = await updateAdminThemePreferenceAction({ theme: 'dark' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Não foi possível');
  });
});
