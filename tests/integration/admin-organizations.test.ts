import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __mockSupabase } from '../setup';

// next/headers mock estendido com `headers` além de `cookies`
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), getAll: vi.fn(() => []) })),
  headers: vi.fn(() => ({ get: vi.fn().mockReturnValue(null) })),
}));

// Mock de platformAdmin
vi.mock('@/lib/auth/platformAdmin', () => ({
  requirePlatformAdmin: vi.fn(),
  requirePlatformAdminRole: vi.fn(),
}));

import {
  getOrganizationsAction,
  getOrganizationDetailAction,
  createOrganizationAction,
  suspendOrganizationAction,
  reactivateOrganizationAction,
} from '@/lib/actions/admin/organizations';

import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';

// ─── Constantes de teste (UUIDs v4 válidos) ───────────────────────────────────

const FAKE_ADMIN = {
  id: 'admin-id',
  profileId: 'test-user-id',
  role: 'owner' as const,
  isActive: true,
  createdAt: new Date().toISOString(),
  email: 'admin@axon.ai',
};

// UUIDs válidos (v4: terceiro grupo começa com 4, quarto com 8-b)
const ORG_ID    = '00000000-0000-4000-8000-000000000001';
const PLAN_ID   = '00000000-0000-4000-8000-000000000002';
const NEW_ORG   = '00000000-0000-4000-8000-000000000003';

/** UUID real da org interna AxonAI (usado em G-07) */
const INTERNAL_ORG_ID = 'c6d506ca-08f0-4714-b330-6eb1a11f679b';

// ─── Reset global antes de cada teste ────────────────────────────────────────
// vi.clearAllMocks() (do setup.ts) limpa call records mas NÃO limpa once queues.
// mockReset() limpa tudo — usamos aqui para garantir estado limpo.

beforeEach(() => {
  vi.mocked(requirePlatformAdmin).mockReset();
  vi.mocked(requirePlatformAdmin).mockResolvedValue(FAKE_ADMIN);
  vi.mocked(requirePlatformAdminRole).mockReset();
  vi.mocked(requirePlatformAdminRole).mockResolvedValue(FAKE_ADMIN);
});

// ─── Helpers de mock ──────────────────────────────────────────────────────────

/** Retorna um mock chainable que resolve em .range() com count */
function makeListMock(result: { data: unknown[]; error: null | object; count: number }) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  const self = () => q;
  for (const m of ['select','eq','in','or','order','limit']) {
    q[m] = vi.fn().mockReturnValue(q);
  }
  q.range      = vi.fn().mockResolvedValue(result);
  q.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  q.head       = vi.fn().mockResolvedValue({ data: null, error: null, count: result.count });
  void self;
  return q;
}

/** Retorna um mock chainable que resolve em .maybeSingle() */
function makeSingleMock(data: unknown) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select','eq','in','order','limit']) {
    q[m] = vi.fn().mockReturnValue(q);
  }
  q.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  q.head        = vi.fn().mockResolvedValue({ data: null, error: null, count: 0 });
  return q;
}

// ─── getOrganizationsAction ───────────────────────────────────────────────────

describe('getOrganizationsAction', () => {
  it('happy path — retorna lista paginada', async () => {
    const mockOrg = { id: ORG_ID, name: 'Acme', slug: 'acme', is_active: true, is_internal: false, created_at: new Date().toISOString() };

    __mockSupabase.from
      .mockReturnValueOnce(makeListMock({ data: [mockOrg], error: null, count: 1 }))
      .mockReturnValueOnce(makeListMock({ data: [], error: null, count: 0 }))
      .mockReturnValueOnce(makeListMock({ data: [], error: null, count: 0 }));

    const result = await getOrganizationsAction({ page: 1, pageSize: 25 });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].slug).toBe('acme');
    expect(result.metadata?.total).toBe(1);
  });

  it('Zod — pageSize inválido retorna success: false sem chamar Supabase', async () => {
    const result = await getOrganizationsAction({ pageSize: 200 }); // max 100
    expect(result.success).toBe(false);
    expect(__mockSupabase.from).not.toHaveBeenCalled();
  });

  it('auth — sem admin retorna success: false', async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValueOnce(new Error('not found'));
    const result = await getOrganizationsAction();
    expect(result.success).toBe(false);
  });

  it('erro de banco retorna success: false', async () => {
    __mockSupabase.from.mockReturnValueOnce(
      makeListMock({ data: [], error: { message: 'db error' }, count: 0 })
    );
    const result = await getOrganizationsAction();
    expect(result.success).toBe(false);
  });
});

// ─── getOrganizationDetailAction ──────────────────────────────────────────────

describe('getOrganizationDetailAction', () => {
  it('happy path — retorna OrgDetail completo', async () => {
    const mockOrg = { id: ORG_ID, name: 'Acme', slug: 'acme', is_active: true, is_internal: false, settings: {}, created_at: new Date().toISOString() };
    const emptyList = makeListMock({ data: [], error: null, count: 0 });

    // 5 calls: organizations, profiles(count), leads(activity), profiles(activity), audit_log
    __mockSupabase.from
      .mockReturnValueOnce(makeSingleMock(mockOrg))  // organizations
      .mockReturnValueOnce(emptyList)                // profiles count (head:true)
      .mockReturnValueOnce(emptyList)                // leads activity
      .mockReturnValueOnce(emptyList)                // profiles activity
      .mockReturnValueOnce(emptyList);               // audit_log
    // rpc: get_current_subscription
    __mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const result = await getOrganizationDetailAction(ORG_ID);
    expect(result.success).toBe(true);
    expect(result.data?.slug).toBe('acme');
    expect(result.data?.recentAuditLog).toEqual([]);
  });

  it('ID UUID inválido retorna success: false sem chamar Supabase', async () => {
    const result = await getOrganizationDetailAction('not-a-uuid');
    expect(result.success).toBe(false);
    expect(__mockSupabase.from).not.toHaveBeenCalled();
  });

  it('auth — sem admin retorna success: false', async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValueOnce(new Error('not found'));
    const result = await getOrganizationDetailAction(ORG_ID);
    expect(result.success).toBe(false);
  });

  it('org não encontrada retorna success: false com mensagem correta', async () => {
    __mockSupabase.from.mockReturnValueOnce(makeSingleMock(null));
    const result = await getOrganizationDetailAction(ORG_ID);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Organização não encontrada.');
  });
});

// ─── createOrganizationAction ─────────────────────────────────────────────────

describe('createOrganizationAction', () => {
  const VALID_INPUT = {
    name: 'Acme Corp',
    slug: 'acme-corp',
    planId: PLAN_ID,
    firstAdminEmail: 'admin@acme.com',
    trialDays: 14,
  };

  it('happy path — retorna id e signupLink', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: NEW_ORG, error: null });
    __mockSupabase.from.mockReturnValueOnce(makeSingleMock({ token: 'invite-token-abc' }));

    const result = await createOrganizationAction(VALID_INPUT);

    expect(result.success).toBe(true);
    expect(result.data?.id).toBe(NEW_ORG);
    expect(result.data?.signupLink).toContain('invite-token-abc');
    expect(__mockSupabase.rpc).toHaveBeenCalledWith(
      'admin_create_organization',
      expect.objectContaining({ p_slug: 'acme-corp', p_plan_id: PLAN_ID })
    );
  });

  it('Zod — slug inválido retorna success: false sem chamar Supabase', async () => {
    const result = await createOrganizationAction({ ...VALID_INPUT, slug: 'SLUG-INVALIDO!' });
    expect(result.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('Zod — email inválido retorna success: false sem chamar Supabase', async () => {
    const result = await createOrganizationAction({ ...VALID_INPUT, firstAdminEmail: 'nao-e-email' });
    expect(result.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('auth — role support não pode criar org (requirePlatformAdminRole rejeita)', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValueOnce(new Error('not found'));
    const result = await createOrganizationAction(VALID_INPUT);
    expect(result.success).toBe(false);
  });

  it('RPC slug_taken → mensagem de erro menciona slug', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('slug_taken') });
    const result = await createOrganizationAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(result.error).toContain('slug');
  });

  it('RPC invalid_plan → mensagem de erro menciona Plano', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('invalid_plan') });
    const result = await createOrganizationAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Plano');
  });
});

// ─── suspendOrganizationAction ────────────────────────────────────────────────

describe('suspendOrganizationAction', () => {
  const VALID_INPUT = {
    id: ORG_ID,
    slugConfirmation: 'acme-corp',
    reason: 'Inadimplência confirmada após 30 dias',
  };

  beforeEach(() => {
    // Por padrão: org 'acme-corp' ativa
    __mockSupabase.from.mockReturnValue(makeSingleMock({ slug: 'acme-corp' }));
  });

  it('happy path — suspende org e retorna ok: true', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await suspendOrganizationAction(VALID_INPUT);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ok: true });
    expect(__mockSupabase.rpc).toHaveBeenCalledWith(
      'admin_suspend_organization',
      expect.objectContaining({ p_org_id: ORG_ID, p_reason: VALID_INPUT.reason })
    );
  });

  it('[G-07] tentar suspender org interna retorna success: false — internal_org_protected', async () => {
    __mockSupabase.from.mockReturnValue(makeSingleMock({ slug: 'axon' }));
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('internal_org_protected') });

    const result = await suspendOrganizationAction({
      id: INTERNAL_ORG_ID,
      slugConfirmation: 'axon',
      reason: 'tentativa de suspensão da org interna',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('interna');
  });

  it('slugConfirmation divergente → success: false sem chamar RPC', async () => {
    const result = await suspendOrganizationAction({
      ...VALID_INPUT,
      slugConfirmation: 'slug-errado',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Slug');
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('Zod — reason muito curta retorna success: false sem chamar Supabase', async () => {
    const result = await suspendOrganizationAction({ ...VALID_INPUT, reason: 'ok' });
    expect(result.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('auth — role billing não pode suspender (requirePlatformAdminRole rejeita)', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValueOnce(new Error('not found'));
    const result = await suspendOrganizationAction(VALID_INPUT);
    expect(result.success).toBe(false);
  });

  it('RPC org_not_active — org já suspensa → mensagem menciona suspensa', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('org_not_active') });
    const result = await suspendOrganizationAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(result.error).toContain('suspensa');
  });
});

// ─── reactivateOrganizationAction ─────────────────────────────────────────────

describe('reactivateOrganizationAction', () => {
  const VALID_INPUT = {
    id: ORG_ID,
    slugConfirmation: 'acme-corp',
  };

  beforeEach(() => {
    __mockSupabase.from.mockReturnValue(makeSingleMock({ slug: 'acme-corp' }));
  });

  it('happy path — reativa org e retorna ok: true', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await reactivateOrganizationAction(VALID_INPUT);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ok: true });
    expect(__mockSupabase.rpc).toHaveBeenCalledWith(
      'admin_reactivate_organization',
      expect.objectContaining({ p_org_id: ORG_ID })
    );
  });

  it('slugConfirmation divergente → success: false sem chamar RPC', async () => {
    const result = await reactivateOrganizationAction({ ...VALID_INPUT, slugConfirmation: 'errado' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Slug');
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('auth — sem admin retorna success: false', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValueOnce(new Error('not found'));
    const result = await reactivateOrganizationAction(VALID_INPUT);
    expect(result.success).toBe(false);
  });

  it('RPC org_not_suspended — org ativa → mensagem menciona suspensa', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('org_not_suspended') });
    const result = await reactivateOrganizationAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(result.error).toContain('suspensa');
  });

  it('Zod — UUID inválido retorna success: false sem chamar Supabase', async () => {
    const result = await reactivateOrganizationAction({ id: 'not-a-uuid', slugConfirmation: 'abc' });
    expect(result.success).toBe(false);
    expect(__mockSupabase.from).not.toHaveBeenCalled();
  });
});
