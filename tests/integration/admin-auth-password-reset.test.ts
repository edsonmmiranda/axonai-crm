import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __mockSupabase } from '../setup';

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), getAll: vi.fn(() => []) })),
  headers: vi.fn(() => ({ get: vi.fn().mockReturnValue(null) })),
}));

const { __mockServiceClient } = vi.hoisted(() => ({
  __mockServiceClient: {
    rpc:  vi.fn().mockResolvedValue({ data: null, error: null }),
    from: vi.fn(),
  },
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => __mockServiceClient),
}));

import {
  completeAdminMfaReenrollAction,
  completeAdminPasswordResetAction,
} from '@/lib/actions/admin/admin-auth';

const FAKE_USER = { id: 'profile-A', email: 'admin@axon.ai' };

interface SupabaseLike {
  auth: {
    getUser:    ReturnType<typeof vi.fn>;
    updateUser: ReturnType<typeof vi.fn>;
    mfa: {
      verify:       ReturnType<typeof vi.fn>;
      listFactors:  ReturnType<typeof vi.fn>;
      unenroll:     ReturnType<typeof vi.fn>;
    };
  };
  from: ReturnType<typeof vi.fn>;
  rpc:  ReturnType<typeof vi.fn>;
}
const supabaseUserClient = __mockSupabase as unknown as SupabaseLike;

beforeEach(() => {
  __mockServiceClient.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  __mockServiceClient.from.mockReset();

  // Augment user-client mock with auth.updateUser + mfa methods (not in default setup).
  supabaseUserClient.auth.updateUser = vi.fn().mockResolvedValue({ data: null, error: null });
  supabaseUserClient.auth.mfa = {
    verify:      vi.fn().mockResolvedValue({ data: null, error: null }),
    listFactors: vi.fn().mockResolvedValue({ data: { totp: [] }, error: null }),
    unenroll:    vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  supabaseUserClient.auth.getUser.mockResolvedValue({
    data:  { user: FAKE_USER },
    error: null,
  });
});

// ── completeAdminPasswordResetAction ────────────────────────────────────────

describe('completeAdminPasswordResetAction', () => {
  const validInput = { newPassword: 'NewStrongPass1!' };

  it('happy — admin reset → updateUser ok → mark RPC chamado', async () => {
    const result = await completeAdminPasswordResetAction(validInput);

    expect(result.success).toBe(true);
    expect(result.data?.redirectTo).toBe('/admin/login');
    expect(supabaseUserClient.auth.updateUser).toHaveBeenCalledWith({
      password: validInput.newPassword,
    });
    expect(__mockServiceClient.rpc).toHaveBeenCalledWith(
      'mark_admin_password_reset',
      expect.objectContaining({ p_profile_id: FAKE_USER.id }),
    );
  });

  it('sessão inválida (getUser → null) → success: false sem chamar updateUser', async () => {
    supabaseUserClient.auth.getUser.mockResolvedValueOnce({
      data: { user: null }, error: null,
    });
    const result = await completeAdminPasswordResetAction(validInput);
    expect(result.success).toBe(false);
    expect(supabaseUserClient.auth.updateUser).not.toHaveBeenCalled();
  });

  it('updateUser falha → success: false sem chamar RPC', async () => {
    supabaseUserClient.auth.updateUser.mockResolvedValueOnce({
      data: null, error: { message: 'weak password' },
    });
    const result = await completeAdminPasswordResetAction(validInput);
    expect(result.success).toBe(false);
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });

  it('Zod fail — senha curta', async () => {
    const result = await completeAdminPasswordResetAction({ newPassword: 'short' });
    expect(result.success).toBe(false);
    expect(supabaseUserClient.auth.updateUser).not.toHaveBeenCalled();
  });
});

// ── completeAdminMfaReenrollAction ─────────────────────────────────────────

describe('completeAdminMfaReenrollAction', () => {
  const validInput = {
    factorId:    'factor-new',
    challengeId: 'challenge-1',
    code:        '123456',
  };

  it('happy COM pending reset request → consume_admin_mfa_reset chamado', async () => {
    // Simulate pending approved reset request found.
    const fromMock = {
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      is:     vi.fn().mockReturnThis(),
      not:    vi.fn().mockReturnThis(),
      gt:     vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'req-1' }, error: null,
      }),
    };
    __mockServiceClient.from.mockReturnValue(fromMock);
    __mockServiceClient.rpc.mockResolvedValue({ data: null, error: null });

    const result = await completeAdminMfaReenrollAction(validInput);

    expect(result.success).toBe(true);
    expect(result.data?.redirectTo).toBe('/admin/dashboard');
    expect(__mockServiceClient.rpc).toHaveBeenCalledWith(
      'consume_admin_mfa_reset',
      expect.objectContaining({
        p_request_id:        'req-1',
        p_target_profile_id: FAKE_USER.id,
      }),
    );
  });

  it('happy SEM pending reset → complete_admin_mfa_reenroll chamado', async () => {
    const fromMock = {
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      is:     vi.fn().mockReturnThis(),
      not:    vi.fn().mockReturnThis(),
      gt:     vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    __mockServiceClient.from.mockReturnValue(fromMock);
    __mockServiceClient.rpc.mockResolvedValue({ data: null, error: null });

    const result = await completeAdminMfaReenrollAction(validInput);

    expect(result.success).toBe(true);
    expect(__mockServiceClient.rpc).toHaveBeenCalledWith(
      'complete_admin_mfa_reenroll',
      expect.objectContaining({ p_profile_id: FAKE_USER.id }),
    );
  });

  it('verify falha → success: false sem chamar RPC', async () => {
    supabaseUserClient.auth.mfa.verify.mockResolvedValueOnce({
      data: null, error: { message: 'invalid code' },
    });
    const result = await completeAdminMfaReenrollAction(validInput);
    expect(result.success).toBe(false);
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });

  it('Zod fail — código não tem 6 dígitos', async () => {
    const result = await completeAdminMfaReenrollAction({
      ...validInput, code: '12',
    });
    expect(result.success).toBe(false);
    expect(supabaseUserClient.auth.mfa.verify).not.toHaveBeenCalled();
  });
});
