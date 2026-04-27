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

import {
  getGrantsAction,
  createGrantAction,
  revokeGrantAction,
} from '@/lib/actions/admin/grants';
import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';

const FAKE_ADMIN_OWNER = {
  id: 'admin-id',
  profileId: 'test-user-id',
  role: 'owner' as const,
  isActive: true,
  createdAt: new Date().toISOString(),
  email: 'admin@axon.ai',
};

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const GRANT_ID = '00000000-0000-4000-8000-0000000000aa';

const VALID_CREATE_INPUT = {
  organizationId: ORG_ID,
  limitKey: 'leads' as const,
  valueOverride: 5000,
  reason: 'Cliente em fase de upsell — janela de 30 dias',
};

function makeQueryMock(result: unknown) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select', 'eq', 'order', 'is', 'in']) {
    q[m] = vi.fn().mockReturnValue(q);
  }
  q.maybeSingle = vi.fn().mockResolvedValue(result);
  q.single      = vi.fn().mockResolvedValue(result);
  // resolved when terminal awaited
  Object.assign(q, { then: undefined });
  return q;
}

function makeListQueryMock(rows: unknown[]) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select', 'eq', 'order']) {
    q[m] = vi.fn().mockReturnValue(q);
  }
  q.is   = vi.fn().mockReturnValue(q);
  q.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  return q;
}

beforeEach(() => {
  vi.mocked(requirePlatformAdmin).mockReset();
  vi.mocked(requirePlatformAdmin).mockResolvedValue(FAKE_ADMIN_OWNER);
  vi.mocked(requirePlatformAdminRole).mockReset();
  vi.mocked(requirePlatformAdminRole).mockResolvedValue(FAKE_ADMIN_OWNER);
  __mockSupabase.rpc.mockReset();
  __mockSupabase.from.mockReset();
});

// ────────────────────────────────────────────────────────────────────────────
// getGrantsAction
// ────────────────────────────────────────────────────────────────────────────

describe('getGrantsAction', () => {
  it('happy path — retorna lista filtrando revogados/expirados por padrão', async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const past   = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const rows = [
      {
        id: GRANT_ID,
        organization_id: ORG_ID,
        limit_key: 'leads',
        value_override: 5000,
        reason: 'Upsell',
        expires_at: future,
        created_at: new Date().toISOString(),
        revoked_at: null,
        created_by: { id: 'p1', full_name: 'Edson' },
        revoked_by: null,
      },
      {
        id: 'expired-grant',
        organization_id: ORG_ID,
        limit_key: 'leads',
        value_override: 100,
        reason: 'Antigo',
        expires_at: past,
        created_at: past,
        revoked_at: null,
        created_by: { id: 'p1', full_name: 'Edson' },
        revoked_by: null,
      },
    ];
    __mockSupabase.from.mockReturnValueOnce(makeListQueryMock(rows));

    const r = await getGrantsAction({
      organizationId: ORG_ID,
      includeRevoked: false,
      includeExpired: false,
    });
    expect(r.success).toBe(true);
    expect(r.data?.items).toHaveLength(1);
    expect(r.data?.items[0].id).toBe(GRANT_ID);
    expect(r.data?.items[0].status).toBe('active');
  });

  it('includeExpired=true mantém grants expirados na lista', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    __mockSupabase.from.mockReturnValueOnce(
      makeListQueryMock([
        {
          id: GRANT_ID,
          organization_id: ORG_ID,
          limit_key: 'users',
          value_override: 50,
          reason: 'Antigo',
          expires_at: past,
          created_at: past,
          revoked_at: null,
          created_by: null,
          revoked_by: null,
        },
      ]),
    );
    const r = await getGrantsAction({
      organizationId: ORG_ID,
      includeRevoked: false,
      includeExpired: true,
    });
    expect(r.success).toBe(true);
    expect(r.data?.items).toHaveLength(1);
    expect(r.data?.items[0].status).toBe('expired');
  });

  it('Zod inválido — organizationId não-uuid', async () => {
    const r = await getGrantsAction({
      organizationId: 'not-a-uuid',
      includeRevoked: false,
      includeExpired: false,
    });
    expect(r.success).toBe(false);
    expect(__mockSupabase.from).not.toHaveBeenCalled();
  });

  it('auth fail — requirePlatformAdmin lança', async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
    const r = await getGrantsAction({
      organizationId: ORG_ID,
      includeRevoked: false,
      includeExpired: false,
    });
    expect(r.success).toBe(false);
  });

  it('erro do Supabase — retorna erro genérico', async () => {
    const failingQuery: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const m of ['select', 'eq', 'order']) {
      failingQuery[m] = vi.fn().mockReturnValue(failingQuery);
    }
    failingQuery.is = vi.fn().mockReturnValue(failingQuery);
    failingQuery.then = (resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { message: 'boom' } });
    __mockSupabase.from.mockReturnValueOnce(failingQuery);

    const r = await getGrantsAction({
      organizationId: ORG_ID,
      includeRevoked: false,
      includeExpired: false,
    });
    expect(r.success).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// createGrantAction
// ────────────────────────────────────────────────────────────────────────────

describe('createGrantAction', () => {
  it('happy path owner — chama RPC admin_grant_limit com args corretos', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: GRANT_ID, error: null });

    const r = await createGrantAction(VALID_CREATE_INPUT);
    expect(r.success).toBe(true);
    expect(r.data?.id).toBe(GRANT_ID);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith(
      'admin_grant_limit',
      expect.objectContaining({
        p_org_id:         ORG_ID,
        p_limit_key:      'leads',
        p_value_override: 5000,
        p_reason:         VALID_CREATE_INPUT.reason,
      }),
    );
  });

  it('happy path com valueOverride=null (ilimitado)', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: GRANT_ID, error: null });
    const r = await createGrantAction({ ...VALID_CREATE_INPUT, valueOverride: null });
    expect(r.success).toBe(true);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith(
      'admin_grant_limit',
      expect.objectContaining({ p_value_override: null }),
    );
  });

  it('Zod fail — valueOverride negativo', async () => {
    const r = await createGrantAction({ ...VALID_CREATE_INPUT, valueOverride: -1 });
    expect(r.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('Zod fail — reason curta (<5)', async () => {
    const r = await createGrantAction({ ...VALID_CREATE_INPUT, reason: 'oi' });
    expect(r.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('Zod fail — expiresAt no passado', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const r = await createGrantAction({ ...VALID_CREATE_INPUT, expiresAt: past });
    expect(r.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('Zod fail — limitKey inválido', async () => {
    const r = await createGrantAction({
      ...VALID_CREATE_INPUT,
      limitKey: 'nuclear_codes' as never,
    });
    expect(r.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('role não-owner é rejeitada via requirePlatformAdminRole', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
    const r = await createGrantAction(VALID_CREATE_INPUT);
    expect(r.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('RPC retorna org_not_found — mapeia para mensagem pt-BR', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'org_not_found', code: 'P0001' },
    });
    const r = await createGrantAction(VALID_CREATE_INPUT);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Organização não encontrada/);
  });

  it('RPC retorna insufficient_privilege — mapeia para mensagem pt-BR', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'insufficient_privilege', code: '42501' },
    });
    const r = await createGrantAction(VALID_CREATE_INPUT);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Permissão insuficiente/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// revokeGrantAction
// ────────────────────────────────────────────────────────────────────────────

describe('revokeGrantAction', () => {
  it('happy path owner — confirmação correta + RPC sucesso', async () => {
    __mockSupabase.from.mockReturnValueOnce(
      makeQueryMock({
        data: { id: GRANT_ID, organization_id: ORG_ID, limit_key: 'leads', revoked_at: null },
        error: null,
      }),
    );
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });

    const r = await revokeGrantAction({ grantId: GRANT_ID, limitKeyConfirmation: 'leads' });
    expect(r.success).toBe(true);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith(
      'admin_revoke_grant',
      expect.objectContaining({ p_grant_id: GRANT_ID }),
    );
  });

  it('limitKeyConfirmation divergente — bloqueia antes da RPC', async () => {
    __mockSupabase.from.mockReturnValueOnce(
      makeQueryMock({
        data: { id: GRANT_ID, organization_id: ORG_ID, limit_key: 'leads', revoked_at: null },
        error: null,
      }),
    );
    const r = await revokeGrantAction({ grantId: GRANT_ID, limitKeyConfirmation: 'products' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/confirmação não corresponde/i);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('grant não encontrado — retorna mensagem específica', async () => {
    __mockSupabase.from.mockReturnValueOnce(makeQueryMock({ data: null, error: null }));
    const r = await revokeGrantAction({ grantId: GRANT_ID, limitKeyConfirmation: 'leads' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/não encontrado/i);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('grant já revogado — RPC retorna grant_already_revoked', async () => {
    __mockSupabase.from.mockReturnValueOnce(
      makeQueryMock({
        data: { id: GRANT_ID, organization_id: ORG_ID, limit_key: 'leads', revoked_at: new Date().toISOString() },
        error: null,
      }),
    );
    __mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'grant_already_revoked', code: 'P0001' },
    });
    const r = await revokeGrantAction({ grantId: GRANT_ID, limitKeyConfirmation: 'leads' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/já foi revogado/i);
  });

  it('role não-owner é rejeitada', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
    const r = await revokeGrantAction({ grantId: GRANT_ID, limitKeyConfirmation: 'leads' });
    expect(r.success).toBe(false);
    expect(__mockSupabase.from).not.toHaveBeenCalled();
  });

  it('grantId não-uuid — Zod fail', async () => {
    const r = await revokeGrantAction({ grantId: 'not-a-uuid', limitKeyConfirmation: 'leads' });
    expect(r.success).toBe(false);
    expect(__mockSupabase.from).not.toHaveBeenCalled();
  });
});
