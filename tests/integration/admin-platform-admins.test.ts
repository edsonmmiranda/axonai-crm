import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), getAll: vi.fn(() => []) })),
  headers: vi.fn(() => ({ get: vi.fn().mockReturnValue(null) })),
}));

vi.mock('@/lib/auth/platformAdmin', () => ({
  requirePlatformAdmin:     vi.fn(),
  requirePlatformAdminRole: vi.fn(),
}));

const { __mockServiceClient, __mockSendEmail } = vi.hoisted(() => ({
  __mockServiceClient: {
    rpc:  vi.fn().mockResolvedValue({ data: null, error: null }),
    from: vi.fn(),
    auth: {
      admin: {
        listUsers:  vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
        createUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    },
  },
  __mockSendEmail: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => __mockServiceClient),
}));

vi.mock('@/lib/email/sender', () => ({
  sendEmail: __mockSendEmail,
}));

vi.mock('@/lib/email/templates/admin-invitation', () => ({
  adminInvitationHtml: vi.fn(() => '<html>x</html>'),
  adminInvitationText: vi.fn(() => 'text'),
}));

import {
  changePlatformAdminRoleAction,
  consumeInvitationAction,
  createInvitationAction,
  deactivatePlatformAdminAction,
  getInvitationByTokenAction,
  listInvitationsAction,
  listPlatformAdminsAction,
  revokeInvitationAction,
} from '@/lib/actions/admin/platform-admins';
import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';

const FAKE_OWNER = {
  id:        'pa-1',
  profileId: 'profile-owner-1',
  role:      'owner' as const,
  isActive:  true,
  createdAt: '2026-04-28T00:00:00Z',
  email:     'owner@axon.ai',
};

const FAKE_INVITATION_ROW = {
  id:                     'inv-1',
  email:                  'newadmin@axon.ai',
  role:                   'support',
  token:                  '11111111-1111-4111-a111-111111111111',
  expires_at:             '2026-05-01T00:00:00Z',
  consumed_at:            null,
  consumed_by_profile_id: null,
  revoked_at:             null,
  revoked_by:             null,
  email_delivery_log_id:  null,
  created_by:             FAKE_OWNER.profileId,
  created_at:             '2026-04-28T00:00:00Z',
};

function makeFromQuery(result: { data: unknown; error: unknown }) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select', 'eq', 'is', 'order', 'update'] as const) {
    q[m] = vi.fn().mockReturnValue(q);
  }
  q.maybeSingle = vi.fn().mockResolvedValue(result);
  q.single      = vi.fn().mockResolvedValue(result);
  q.insert      = vi.fn().mockResolvedValue(result);
  return q;
}

const FORBIDDEN = Object.assign(new Error('NEXT_NOT_FOUND'), { digest: 'NEXT_NOT_FOUND' });

beforeEach(() => {
  vi.mocked(requirePlatformAdmin).mockReset().mockResolvedValue(FAKE_OWNER);
  vi.mocked(requirePlatformAdminRole).mockReset().mockResolvedValue(FAKE_OWNER);
  __mockServiceClient.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  __mockServiceClient.from.mockReset();
  __mockServiceClient.auth.admin.listUsers.mockReset()
    .mockResolvedValue({ data: { users: [] }, error: null });
  __mockServiceClient.auth.admin.createUser.mockReset()
    .mockResolvedValue({ data: { user: null }, error: null });
  __mockSendEmail.mockReset();
});

// ── READ actions ────────────────────────────────────────────────────────────

describe('listPlatformAdminsAction', () => {
  it('happy — qualquer platform admin lista', async () => {
    __mockServiceClient.rpc.mockResolvedValue({ data: [], error: null });
    const result = await listPlatformAdminsAction();
    expect(result.success).toBe(true);
    expect(__mockServiceClient.rpc).toHaveBeenCalledWith('admin_list_platform_admins');
  });
});

describe('listInvitationsAction', () => {
  it('happy — filtro pending default', async () => {
    __mockServiceClient.rpc.mockResolvedValue({ data: [FAKE_INVITATION_ROW], error: null });
    const result = await listInvitationsAction();
    expect(result.success).toBe(true);
    expect(__mockServiceClient.rpc).toHaveBeenCalledWith(
      'admin_list_platform_admin_invitations',
      { p_filter: 'pending' },
    );
  });
});

// ── createInvitationAction ──────────────────────────────────────────────────

describe('createInvitationAction', () => {
  beforeEach(() => {
    __mockServiceClient.from.mockReturnValue(makeFromQuery({ data: null, error: null }));
  });

  it('happy + delivery sent', async () => {
    __mockServiceClient.rpc.mockResolvedValue({ data: FAKE_INVITATION_ROW, error: null });
    __mockSendEmail.mockResolvedValue({ status: 'sent', deliveryLogId: 'log-1' });

    const result = await createInvitationAction({ email: 'newadmin@axon.ai', role: 'support' });

    expect(result.success).toBe(true);
    expect(result.data?.deliveryStatus).toBe('sent');
    expect(__mockServiceClient.rpc).toHaveBeenCalledWith(
      'admin_create_platform_admin_invitation',
      expect.objectContaining({
        p_email:            'newadmin@axon.ai',
        p_role:             'support',
        p_actor_profile_id: FAKE_OWNER.profileId,
      }),
    );
    expect(__mockSendEmail).toHaveBeenCalled();
  });

  it('happy + delivery fallback_offline retorna offlineLink', async () => {
    __mockServiceClient.rpc.mockResolvedValue({ data: FAKE_INVITATION_ROW, error: null });
    __mockSendEmail.mockResolvedValue({
      status:        'fallback_offline',
      deliveryLogId: 'log-1',
      offlineLink:   'https://app/admin/accept-invite/xyz',
    });

    const result = await createInvitationAction({ email: 'newadmin@axon.ai', role: 'billing' });

    expect(result.success).toBe(true);
    expect(result.data?.deliveryStatus).toBe('fallback_offline');
    expect(result.data?.offlineLink).toBe('https://app/admin/accept-invite/xyz');
  });

  it('Zod fail — email inválido → não chama RPC', async () => {
    const result = await createInvitationAction({ email: 'not-email', role: 'support' });
    expect(result.success).toBe(false);
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });

  it('Zod fail — role fora do enum', async () => {
    const result = await createInvitationAction({
      email: 'x@x.com',
      role:  'invalid' as 'owner',
    });
    expect(result.success).toBe(false);
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });

  it('RBAC — support tenta criar → erro de auth (requirePlatformAdminRole rejeita)', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValueOnce(FORBIDDEN);
    const result = await createInvitationAction({ email: 'x@x.com', role: 'support' });
    expect(result.success).toBe(false);
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });

  it('email_already_active_admin → mensagem amigável', async () => {
    __mockServiceClient.rpc.mockResolvedValue({
      data:  null,
      error: { message: 'email_already_active_admin' },
    });
    const result = await createInvitationAction({ email: 'x@axon.ai', role: 'support' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/já é admin ativo/i);
  });

  it('invitation_already_pending → mensagem amigável', async () => {
    __mockServiceClient.rpc.mockResolvedValue({
      data:  null,
      error: { message: 'invitation_already_pending' },
    });
    const result = await createInvitationAction({ email: 'x@axon.ai', role: 'support' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/pendente/i);
  });
});

// ── revokeInvitationAction ─────────────────────────────────────────────────

describe('revokeInvitationAction', () => {
  it('happy', async () => {
    __mockServiceClient.rpc.mockResolvedValue({ data: null, error: null });
    const result = await revokeInvitationAction({
      id: '11111111-1111-4111-a111-111111111111',
    });
    expect(result.success).toBe(true);
  });

  it('invitation_not_found_or_terminal → erro tipado', async () => {
    __mockServiceClient.rpc.mockResolvedValue({
      data:  null,
      error: { message: 'invitation_not_found_or_terminal' },
    });
    const result = await revokeInvitationAction({
      id: '11111111-1111-4111-a111-111111111111',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/já em estado terminal/i);
  });

  it('Zod fail — id inválido', async () => {
    const result = await revokeInvitationAction({ id: 'not-uuid' });
    expect(result.success).toBe(false);
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });
});

// ── consumeInvitationAction ────────────────────────────────────────────────

describe('consumeInvitationAction', () => {
  const validToken = '22222222-2222-4222-a222-222222222222';
  const orgRowQuery = makeFromQuery({ data: { id: 'org-axon-id' }, error: null });

  it('happy — invitation válido + cria user + cria profile + consume', async () => {
    __mockServiceClient.rpc
      // 1. get_invitation_by_token
      .mockResolvedValueOnce({
        data: {
          email:       'new@axon.ai',
          role:        'support',
          expires_at:  '2999-01-01T00:00:00Z',
          consumed_at: null,
          revoked_at:  null,
        },
        error: null,
      })
      // 2. admin_consume_platform_admin_invitation
      .mockResolvedValueOnce({ data: { id: 'pa-new' }, error: null });

    __mockServiceClient.from
      // org axon select
      .mockReturnValueOnce(orgRowQuery)
      // profile select (não existe)
      .mockReturnValueOnce(makeFromQuery({ data: null, error: null }))
      // profile insert
      .mockReturnValueOnce(makeFromQuery({ data: null, error: null }));

    __mockServiceClient.auth.admin.createUser.mockResolvedValue({
      data:  { user: { id: 'user-new' } },
      error: null,
    });

    const result = await consumeInvitationAction({ token: validToken, password: 'StrongPass1!' });

    expect(result.success).toBe(true);
    expect(result.data?.redirectTo).toBe('/admin/mfa-enroll?firstEnroll=true');
    expect(__mockServiceClient.auth.admin.createUser).toHaveBeenCalled();
  });

  it('invitation_already_consumed → erro tipado (G-15 simétrico)', async () => {
    __mockServiceClient.rpc.mockResolvedValueOnce({
      data: {
        email:       'new@axon.ai',
        role:        'support',
        expires_at:  '2999-01-01T00:00:00Z',
        consumed_at: '2026-04-28T00:00:00Z',
        revoked_at:  null,
      },
      error: null,
    });

    const result = await consumeInvitationAction({ token: validToken, password: 'StrongPass1!' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/já foi utilizado/i);
  });

  it('invitation_expired → erro tipado', async () => {
    __mockServiceClient.rpc.mockResolvedValueOnce({
      data: {
        email:       'new@axon.ai',
        role:        'support',
        expires_at:  '2020-01-01T00:00:00Z',
        consumed_at: null,
        revoked_at:  null,
      },
      error: null,
    });

    const result = await consumeInvitationAction({ token: validToken, password: 'StrongPass1!' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/expir/i);
  });

  it('profile_org_mismatch — conta existe em outra org', async () => {
    __mockServiceClient.rpc.mockResolvedValueOnce({
      data: {
        email: 'new@axon.ai', role: 'support',
        expires_at: '2999-01-01T00:00:00Z',
        consumed_at: null, revoked_at: null,
      },
      error: null,
    });

    __mockServiceClient.from
      .mockReturnValueOnce(orgRowQuery)
      .mockReturnValueOnce(makeFromQuery({
        data:  { id: 'user-existing', organization_id: 'other-org', email: 'new@axon.ai' },
        error: null,
      }));

    __mockServiceClient.auth.admin.listUsers.mockResolvedValue({
      data:  { users: [{ id: 'user-existing', email: 'new@axon.ai' }] },
      error: null,
    });

    const result = await consumeInvitationAction({ token: validToken, password: 'StrongPass1!' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outra organização/i);
  });

  it('Zod fail — senha curta', async () => {
    const result = await consumeInvitationAction({ token: validToken, password: 'short' });
    expect(result.success).toBe(false);
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });
});

// ── getInvitationByTokenAction ─────────────────────────────────────────────

describe('getInvitationByTokenAction', () => {
  it('happy — status valid', async () => {
    __mockServiceClient.rpc.mockResolvedValue({
      data: {
        email:       'x@axon.ai',
        role:        'owner',
        expires_at:  '2999-01-01T00:00:00Z',
        consumed_at: null,
        revoked_at:  null,
      },
      error: null,
    });
    const result = await getInvitationByTokenAction('33333333-3333-4333-a333-333333333333');
    expect(result.success).toBe(true);
    expect(result.data?.status).toBe('valid');
  });

  it('status expired', async () => {
    __mockServiceClient.rpc.mockResolvedValue({
      data: {
        email: 'x@axon.ai', role: 'owner',
        expires_at: '2020-01-01T00:00:00Z',
        consumed_at: null, revoked_at: null,
      },
      error: null,
    });
    const result = await getInvitationByTokenAction('33333333-3333-4333-a333-333333333333');
    expect(result.success).toBe(true);
    expect(result.data?.status).toBe('expired');
  });
});

// ── changePlatformAdminRoleAction ──────────────────────────────────────────

describe('changePlatformAdminRoleAction', () => {
  const validId = '44444444-4444-4444-a444-444444444444';

  it('happy', async () => {
    __mockServiceClient.rpc.mockResolvedValue({
      data:  { id: validId, role: 'billing' },
      error: null,
    });
    const result = await changePlatformAdminRoleAction({ id: validId, newRole: 'billing' });
    expect(result.success).toBe(true);
  });

  it('last_owner_protected (G-08) → mensagem amigável', async () => {
    __mockServiceClient.rpc.mockResolvedValue({
      data:  null,
      error: { message: 'last_owner_protected' },
    });
    const result = await changePlatformAdminRoleAction({ id: validId, newRole: 'support' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/último owner/i);
  });
});

// ── deactivatePlatformAdminAction ──────────────────────────────────────────

describe('deactivatePlatformAdminAction', () => {
  const validId = '55555555-5555-4555-a555-555555555555';

  it('happy — confirmEmail bate', async () => {
    __mockServiceClient.from
      .mockReturnValueOnce(makeFromQuery({ data: { profile_id: 'p-target' }, error: null }))
      .mockReturnValueOnce(makeFromQuery({ data: { email: 'target@axon.ai' }, error: null }));
    __mockServiceClient.rpc.mockResolvedValue({ data: null, error: null });

    const result = await deactivatePlatformAdminAction({
      id: validId, confirmEmail: 'target@axon.ai',
    });
    expect(result.success).toBe(true);
  });

  it('confirm_email_mismatch → não chama RPC', async () => {
    __mockServiceClient.from
      .mockReturnValueOnce(makeFromQuery({ data: { profile_id: 'p-target' }, error: null }))
      .mockReturnValueOnce(makeFromQuery({ data: { email: 'target@axon.ai' }, error: null }));

    const result = await deactivatePlatformAdminAction({
      id: validId, confirmEmail: 'wrong@axon.ai',
    });
    expect(result.success).toBe(false);
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });

  it('last_owner_protected (G-08) → mensagem amigável', async () => {
    __mockServiceClient.from
      .mockReturnValueOnce(makeFromQuery({ data: { profile_id: 'p-target' }, error: null }))
      .mockReturnValueOnce(makeFromQuery({ data: { email: 'target@axon.ai' }, error: null }));
    __mockServiceClient.rpc.mockResolvedValue({
      data:  null,
      error: { message: 'last_owner_protected' },
    });

    const result = await deactivatePlatformAdminAction({
      id: validId, confirmEmail: 'target@axon.ai',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/último owner/i);
  });
});
