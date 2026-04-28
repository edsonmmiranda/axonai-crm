import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), getAll: vi.fn(() => []) })),
  headers: vi.fn(() => ({ get: vi.fn().mockReturnValue(null) })),
}));

vi.mock('@/lib/auth/platformAdmin', () => ({
  requirePlatformAdmin:     vi.fn(),
  requirePlatformAdminRole: vi.fn(),
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
  approveMfaResetAction,
  requestMfaResetAction,
  revokeMfaResetRequestAction,
  listMfaResetRequestsAction,
} from '@/lib/actions/admin/platform-admins';
import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';

const FAKE_OWNER = {
  id:        'pa-1',
  profileId: 'profile-A',
  role:      'owner' as const,
  isActive:  true,
  createdAt: '2026-04-28T00:00:00Z',
  email:     'a@axon.ai',
};

const FAKE_REQUEST_ROW = {
  id:                       'req-1',
  target_platform_admin_id: 'pa-2',
  target_profile_id:        'profile-B',
  requested_by:             FAKE_OWNER.profileId,
  reason:                   'Lost TOTP device',
  requested_at:             '2026-04-28T00:00:00Z',
  expires_at:               '2026-04-29T00:00:00Z',
  approved_by:              null,
  approved_at:              null,
  consumed_at:              null,
  revoked_at:               null,
  revoked_by:               null,
};

const FORBIDDEN = Object.assign(new Error('NEXT_NOT_FOUND'), { digest: 'NEXT_NOT_FOUND' });

beforeEach(() => {
  vi.mocked(requirePlatformAdmin).mockReset().mockResolvedValue(FAKE_OWNER);
  vi.mocked(requirePlatformAdminRole).mockReset().mockResolvedValue(FAKE_OWNER);
  __mockServiceClient.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  __mockServiceClient.from.mockReset();
});

// ── listMfaResetRequestsAction ─────────────────────────────────────────────

describe('listMfaResetRequestsAction', () => {
  it('happy — qualquer admin lista pedidos pendentes', async () => {
    __mockServiceClient.rpc.mockResolvedValue({ data: [FAKE_REQUEST_ROW], error: null });
    const result = await listMfaResetRequestsAction();
    expect(result.success).toBe(true);
    expect(__mockServiceClient.rpc).toHaveBeenCalledWith(
      'admin_list_mfa_reset_requests',
      { p_filter: 'pending' },
    );
  });
});

// ── requestMfaResetAction ──────────────────────────────────────────────────

describe('requestMfaResetAction', () => {
  const validInput = {
    targetAdminId: '11111111-1111-4111-a111-111111111111',
    reason:        'Lost TOTP device after phone wipe',
  };

  it('happy — owner solicita reset para outro admin', async () => {
    __mockServiceClient.rpc.mockResolvedValue({ data: FAKE_REQUEST_ROW, error: null });
    const result = await requestMfaResetAction(validInput);
    expect(result.success).toBe(true);
    expect(__mockServiceClient.rpc).toHaveBeenCalledWith(
      'admin_request_mfa_reset',
      expect.objectContaining({
        p_target_admin_id:  validInput.targetAdminId,
        p_reason:           validInput.reason,
        p_actor_profile_id: FAKE_OWNER.profileId,
      }),
    );
  });

  it('self_request_forbidden → mensagem amigável', async () => {
    __mockServiceClient.rpc.mockResolvedValue({
      data: null, error: { message: 'self_request_forbidden' },
    });
    const result = await requestMfaResetAction(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/si mesmo/i);
  });

  it('mfa_reset_already_pending → mensagem amigável', async () => {
    __mockServiceClient.rpc.mockResolvedValue({
      data: null, error: { message: 'mfa_reset_already_pending' },
    });
    const result = await requestMfaResetAction(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/pendente/i);
  });

  it('Zod fail — reason curto (< 5 chars)', async () => {
    const result = await requestMfaResetAction({ ...validInput, reason: 'no' });
    expect(result.success).toBe(false);
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });

  it('RBAC — support tenta solicitar → erro de auth', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValueOnce(FORBIDDEN);
    const result = await requestMfaResetAction(validInput);
    expect(result.success).toBe(false);
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });
});

// ── approveMfaResetAction ──────────────────────────────────────────────────

describe('approveMfaResetAction', () => {
  const validInput = { requestId: '22222222-2222-4222-a222-222222222222' };

  it('happy — owner C aprova pedido aberto por owner A para target B', async () => {
    __mockServiceClient.rpc.mockResolvedValue({ data: null, error: null });
    const result = await approveMfaResetAction(validInput);
    expect(result.success).toBe(true);
    expect(__mockServiceClient.rpc).toHaveBeenCalledWith(
      'admin_approve_mfa_reset',
      expect.objectContaining({
        p_request_id:       validInput.requestId,
        p_actor_profile_id: FAKE_OWNER.profileId,
      }),
    );
  });

  it('self_approve_forbidden → mensagem amigável', async () => {
    __mockServiceClient.rpc.mockResolvedValue({
      data: null, error: { message: 'self_approve_forbidden' },
    });
    const result = await approveMfaResetAction(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/abriu/i);
  });

  it('target_approve_forbidden → mensagem amigável', async () => {
    __mockServiceClient.rpc.mockResolvedValue({
      data: null, error: { message: 'target_approve_forbidden' },
    });
    const result = await approveMfaResetAction(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/alvo é você/i);
  });

  it('mfa_reset_request_expired → mensagem amigável', async () => {
    __mockServiceClient.rpc.mockResolvedValue({
      data: null, error: { message: 'mfa_reset_request_expired' },
    });
    const result = await approveMfaResetAction(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/expir/i);
  });

  it('mfa_reset_already_approved → mensagem amigável', async () => {
    __mockServiceClient.rpc.mockResolvedValue({
      data: null, error: { message: 'mfa_reset_already_approved' },
    });
    const result = await approveMfaResetAction(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/já foi aprovado/i);
  });

  it('Zod fail — id inválido', async () => {
    const result = await approveMfaResetAction({ requestId: 'not-uuid' });
    expect(result.success).toBe(false);
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });
});

// ── revokeMfaResetRequestAction ────────────────────────────────────────────

describe('revokeMfaResetRequestAction', () => {
  const validInput = { requestId: '33333333-3333-4333-a333-333333333333' };

  it('happy — owner revoga pedido pendente', async () => {
    __mockServiceClient.rpc.mockResolvedValue({ data: null, error: null });
    const result = await revokeMfaResetRequestAction(validInput);
    expect(result.success).toBe(true);
  });

  it('mfa_reset_request_not_pending → mensagem amigável', async () => {
    __mockServiceClient.rpc.mockResolvedValue({
      data: null, error: { message: 'mfa_reset_request_not_pending' },
    });
    const result = await revokeMfaResetRequestAction(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/não está pendente/i);
  });
});
