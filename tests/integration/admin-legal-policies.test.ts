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
  getLegalPolicyVersionsAction,
  getActiveLegalPoliciesAction,
  createLegalPolicyAction,
} from '@/lib/actions/admin/legal-policies';
import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';

const FAKE_ADMIN = { id: 'a', profileId: 'test-user-id', role: 'owner' as const, isActive: true, createdAt: '', email: '' };

const POLICY_ROW = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'terms' as const,
  version: 1,
  effective_at: '2026-01-01T00:00:00Z',
  summary: 'Termos iniciais da plataforma',
  content_md: 'x'.repeat(50),
  created_at: '2026-01-01T00:00:00Z',
  created_by: { id: 'admin-id', full_name: 'Edson Miranda' },
};

function makeFromMock(data: unknown, error: unknown = null) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select','eq','order','single','maybeSingle']) q[m] = vi.fn().mockReturnValue(q);
  q.order  = vi.fn().mockResolvedValue({ data, error });
  q.single = vi.fn().mockResolvedValue({ data: Array.isArray(data) ? data[0] : data, error });
  return q;
}

beforeEach(() => {
  vi.mocked(requirePlatformAdmin).mockReset().mockResolvedValue(FAKE_ADMIN);
  vi.mocked(requirePlatformAdminRole).mockReset().mockResolvedValue(FAKE_ADMIN);
  __mockSupabase.rpc.mockReset();
  __mockSupabase.from.mockReset();
});

// ── getLegalPolicyVersionsAction ──────────────────────────────────────────────

describe('getLegalPolicyVersionsAction', () => {
  it('happy path — retorna versões ordenadas DESC', async () => {
    __mockSupabase.from.mockReturnValue(makeFromMock([POLICY_ROW, { ...POLICY_ROW, version: 2 }]));
    const result = await getLegalPolicyVersionsAction({ kind: 'terms' });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data![0].kind).toBe('terms');
  });

  it('lista vazia — retorna array vazio (kind sem versões)', async () => {
    __mockSupabase.from.mockReturnValue(makeFromMock([]));
    const result = await getLegalPolicyVersionsAction({ kind: 'privacy' });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(0);
  });

  it('kind inválido — Zod falha antes do Supabase', async () => {
    const result = await getLegalPolicyVersionsAction({ kind: 'invalid_kind' as 'terms' });
    expect(result.success).toBe(false);
    expect(__mockSupabase.from).not.toHaveBeenCalled();
  });

  it('auth fail → success: false', async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValue(new Error('Unauthorized'));
    const result = await getLegalPolicyVersionsAction({ kind: 'terms' });
    expect(result.success).toBe(false);
  });
});

// ── getActiveLegalPoliciesAction ──────────────────────────────────────────────

describe('getActiveLegalPoliciesAction', () => {
  it('happy path — retorna entrada por kind, vigente onde existe', async () => {
    __mockSupabase.rpc.mockResolvedValue({ data: [POLICY_ROW], error: null });
    const result = await getActiveLegalPoliciesAction();
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(4); // terms, privacy, dpa, cookies
    const terms = result.data!.find(e => e.kind === 'terms');
    expect(terms?.activeVersion).not.toBeNull();
    expect(terms?.activeVersion?.version).toBe(1);
  });

  it('kind sem versão vigente — activeVersion=null', async () => {
    __mockSupabase.rpc.mockResolvedValue({ data: [], error: null });
    const result = await getActiveLegalPoliciesAction();
    expect(result.success).toBe(true);
    for (const entry of result.data!) {
      expect(entry.activeVersion).toBeNull();
    }
  });
});

// ── createLegalPolicyAction ───────────────────────────────────────────────────

describe('createLegalPolicyAction', () => {
  const VALID_INPUT = {
    kind: 'terms' as const,
    effectiveAt: new Date('2026-06-01'),
    contentMd: 'x'.repeat(50),
    summary: 'Primeira versão oficial dos termos.',
  };

  it('happy path — chama RPC e retorna id + kind + version', async () => {
    const newId = '00000000-0000-4000-8000-0000000000ff';
    __mockSupabase.rpc.mockResolvedValue({ data: newId, error: null });
    __mockSupabase.from.mockReturnValue(makeFromMock({ version: 1 }));
    const result = await createLegalPolicyAction(VALID_INPUT);
    expect(result.success).toBe(true);
    expect(result.data?.id).toBe(newId);
    expect(result.data?.kind).toBe('terms');
    expect(__mockSupabase.rpc).toHaveBeenCalledWith('admin_create_legal_policy', expect.objectContaining({ p_kind: 'terms' }));
  });

  it('segunda versão — version auto-incrementa (trigger SQL; RPC retorna novo id)', async () => {
    const newId = '00000000-0000-4000-8000-0000000000ee';
    __mockSupabase.rpc.mockResolvedValue({ data: newId, error: null });
    __mockSupabase.from.mockReturnValue(makeFromMock({ version: 2 }));
    const result = await createLegalPolicyAction({ ...VALID_INPUT, summary: 'Segunda versão.' });
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(2);
  });

  it('Zod fail — contentMd < 50 chars → success: false sem chamar RPC', async () => {
    const result = await createLegalPolicyAction({ ...VALID_INPUT, contentMd: 'curto' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('50');
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('Zod fail — kind inválido → success: false sem chamar RPC', async () => {
    const result = await createLegalPolicyAction({ ...VALID_INPUT, kind: 'unknown' as 'terms' });
    expect(result.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('RBAC — support não pode criar (requirePlatformAdminRole lança)', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValue(new Error('Acesso negado'));
    const result = await createLegalPolicyAction(VALID_INPUT);
    expect(result.success).toBe(false);
  });

  it('effectiveAt no passado — é permitido (admin pode registrar versão retroativa)', async () => {
    const newId = '00000000-0000-4000-8000-0000000000dd';
    __mockSupabase.rpc.mockResolvedValue({ data: newId, error: null });
    __mockSupabase.from.mockReturnValue(makeFromMock({ version: 1 }));
    const result = await createLegalPolicyAction({ ...VALID_INPUT, effectiveAt: new Date('2020-01-01') });
    expect(result.success).toBe(true);
  });

  it('RPC retorna unauthorized → mensagem amigável em pt-BR', async () => {
    __mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'unauthorized' } });
    const result = await createLegalPolicyAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(result.error).toContain('owner');
  });

  it('summary curto → Zod fail antes do Supabase', async () => {
    const result = await createLegalPolicyAction({ ...VALID_INPUT, summary: 'curto' });
    expect(result.success).toBe(false);
    expect(__mockSupabase.rpc).not.toHaveBeenCalled();
  });
});
