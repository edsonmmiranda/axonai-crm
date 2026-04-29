import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), getAll: vi.fn(() => []) })),
  headers: vi.fn(() => ({ get: vi.fn().mockReturnValue(null) })),
}));

vi.mock('@/lib/auth/platformAdmin', () => ({
  requirePlatformAdmin:     vi.fn(),
  requirePlatformAdminRole: vi.fn(),
}));

import { __mockSupabase } from '../setup';
import {
  listAuditLogAction,
  getAuditLogEntryAction,
  searchAuditActorsAction,
  getAuditActionRegistryAction,
} from '@/lib/actions/admin/audit';
import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';

const FAKE_OWNER = {
  id:         'pa-1',
  profileId:  'profile-owner-1',
  role:       'owner' as const,
  isActive:   true,
  createdAt:  '2026-04-28T00:00:00Z',
  email:      'owner@axon.ai',
  adminTheme: 'light' as const,
};
const FAKE_BILLING = { ...FAKE_OWNER, id: 'pa-3', profileId: 'profile-billing-3', role: 'billing' as const, email: 'billing@axon.ai' };

// UUIDs válidos (RFC 4122 v4): position 15 = '4' (version), position 20 ∈ {8,9,a,b} (variant)
const VALID_UUID_1     = '00000000-0000-4000-8000-000000000001';
const VALID_UUID_2     = '00000000-0000-4000-8000-000000000002';
const VALID_UUID_3     = '00000000-0000-4000-8000-000000000003';
const VALID_UUID_ACTOR = '11111111-1111-4111-8111-111111111111';
const VALID_UUID_ORG   = '22222222-2222-4222-8222-222222222222';

const SAMPLE_ROW = {
  id:                     VALID_UUID_1,
  occurred_at:            '2026-04-28T12:00:00Z',
  actor_profile_id:       VALID_UUID_ACTOR,
  actor_email_snapshot:   'owner@axon.ai',
  action:                 'org.suspend',
  target_type:            'organization',
  target_id:              VALID_UUID_ORG,
  target_organization_id: VALID_UUID_ORG,
  diff_before:            { is_active: true },
  diff_after:             { is_active: false },
  ip_address:             '198.51.100.1',
  user_agent:             'Mozilla/5.0',
  metadata:               { reason: 'fraud' },
};

/**
 * Mock chainable que resolve via `.then` (await direto na query).
 * Cobre os métodos usados em listAuditLogAction.
 */
function makeListQueryMock(result: { data: unknown[] | null; error: unknown }) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select', 'eq', 'in', 'or', 'order', 'limit', 'gte', 'lte']) {
    q[m] = vi.fn().mockReturnValue(q);
  }
  (q as unknown as { then: (resolve: (v: unknown) => void) => void }).then = (resolve) => resolve(result);
  return q;
}

/**
 * Mock chainable que resolve em `.maybeSingle()`.
 * Cobre os métodos usados em getAuditLogEntryAction.
 */
function makeMaybeSingleMock(result: { data: unknown | null; error: unknown }) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select', 'eq', 'or', 'limit']) {
    q[m] = vi.fn().mockReturnValue(q);
  }
  q.maybeSingle = vi.fn().mockResolvedValue(result);
  return q;
}

/**
 * Mock chainable para searchAuditActorsAction (terminal `.limit` awaitable).
 */
function makeSearchActorsMock(rows: unknown[]) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select', 'not', 'ilike', 'order']) {
    q[m] = vi.fn().mockReturnValue(q);
  }
  (q as unknown as { limit: (n: number) => Promise<unknown> }).limit = vi.fn().mockResolvedValue({ data: rows, error: null });
  return q;
}

beforeEach(() => {
  vi.mocked(requirePlatformAdmin).mockReset();
  vi.mocked(requirePlatformAdmin).mockResolvedValue(FAKE_OWNER);
  __mockSupabase.from.mockReset();
});

describe('admin audit Server Actions', () => {
  /* ──────────────────────────── listAuditLogAction ──────────────────────── */
  describe('listAuditLogAction', () => {
    it('happy path: retorna primeira página + nextCursor null quando ≤ PAGE_SIZE', async () => {
      __mockSupabase.from.mockReturnValueOnce(makeListQueryMock({ data: [SAMPLE_ROW], error: null }));

      const result = await listAuditLogAction({});
      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.rows).toHaveLength(1);
        expect(result.data.rows[0].action).toBe('org.suspend');
        expect(result.data.nextCursor).toBeNull();
      }
    });

    it('mais que PAGE_SIZE itens → nextCursor não-null', async () => {
      const big = Array.from({ length: 51 }).map((_, i) => ({
        ...SAMPLE_ROW,
        id: `id-${i}`,
        occurred_at: new Date(Date.UTC(2026, 3, 28, 12, 0, 51 - i)).toISOString(),
      }));
      __mockSupabase.from.mockReturnValueOnce(makeListQueryMock({ data: big, error: null }));

      const result = await listAuditLogAction({});
      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.rows).toHaveLength(50);
        expect(result.data.nextCursor).not.toBeNull();
      }
    });

    it('billing: aplica filtro regex via .or() com 4 prefixos', async () => {
      vi.mocked(requirePlatformAdmin).mockResolvedValueOnce(FAKE_BILLING);
      const queryMock = makeListQueryMock({ data: [], error: null });
      __mockSupabase.from.mockReturnValueOnce(queryMock);

      await listAuditLogAction({});

      const orCalls = (queryMock.or as ReturnType<typeof vi.fn>).mock.calls;
      const billingCall = orCalls.find((args) =>
        typeof args[0] === 'string'
          && args[0].includes('action.like.org.%')
          && args[0].includes('action.like.plan.%')
          && args[0].includes('action.like.subscription.%')
          && args[0].includes('action.like.grant.%'),
      );
      expect(billingCall).toBeDefined();
    });

    it('owner: NÃO aplica filtro de billing', async () => {
      const queryMock = makeListQueryMock({ data: [], error: null });
      __mockSupabase.from.mockReturnValueOnce(queryMock);

      await listAuditLogAction({});

      const orCalls = (queryMock.or as ReturnType<typeof vi.fn>).mock.calls;
      const billingCall = orCalls.find((args) =>
        typeof args[0] === 'string'
          && args[0].includes('action.like.org.%')
          && args[0].includes('action.like.plan.%'),
      );
      expect(billingCall).toBeUndefined();
    });

    it('rejeita filtros inválidos (Zod) → success: false sem chamar Supabase', async () => {
      const result = await listAuditLogAction({ actions: ['INVALID-NO-DOT'] } as never);
      expect(result.success).toBe(false);
      expect(__mockSupabase.from).not.toHaveBeenCalled();
    });

    it('aceita filtro period preset 24h e aplica gte/lte', async () => {
      const queryMock = makeListQueryMock({ data: [], error: null });
      __mockSupabase.from.mockReturnValueOnce(queryMock);

      await listAuditLogAction({ period: { preset: '24h' } });

      expect(queryMock.gte).toHaveBeenCalled();
      expect(queryMock.lte).toHaveBeenCalled();
    });

    it('rejeita period custom com from > to (Zod refine)', async () => {
      const result = await listAuditLogAction({
        period: { preset: 'custom', from: '2026-04-28T12:00:00Z', to: '2026-04-27T12:00:00Z' } as never,
      });
      expect(result.success).toBe(false);
    });

    it('aplica filtro action via .in() quando passa actions', async () => {
      const queryMock = makeListQueryMock({ data: [], error: null });
      __mockSupabase.from.mockReturnValueOnce(queryMock);

      await listAuditLogAction({ actions: ['org.suspend', 'org.reactivate'] });

      expect(queryMock.in).toHaveBeenCalledWith('action', ['org.suspend', 'org.reactivate']);
    });

    it('aplica filtro actor_profile_id via .eq()', async () => {
      const queryMock = makeListQueryMock({ data: [], error: null });
      __mockSupabase.from.mockReturnValueOnce(queryMock);

      await listAuditLogAction({ actorProfileId: VALID_UUID_ACTOR });

      expect(queryMock.eq).toHaveBeenCalledWith('actor_profile_id', VALID_UUID_ACTOR);
    });

    it('erro de DB → mensagem genérica', async () => {
      __mockSupabase.from.mockReturnValueOnce(makeListQueryMock({ data: null, error: { message: 'connection lost' } }));

      const result = await listAuditLogAction({});
      expect(result.success).toBe(false);
      expect(result.error).toBe('Não foi possível carregar o audit.');
    });

    it('paginação keyset: chama .or() com formato (occurred_at lt OR (eq AND id lt))', async () => {
      const queryMock = makeListQueryMock({ data: [], error: null });
      __mockSupabase.from.mockReturnValueOnce(queryMock);

      await listAuditLogAction({}, { occurredAt: '2026-04-28T11:00:00Z', id: VALID_UUID_3 });

      const orCalls = (queryMock.or as ReturnType<typeof vi.fn>).mock.calls;
      const cursorCall = orCalls.find((args) =>
        typeof args[0] === 'string' && args[0].includes('occurred_at.lt.2026-04-28T11:00:00Z'),
      );
      expect(cursorCall).toBeDefined();
    });
  });

  /* ──────────────────────────── getAuditLogEntryAction ──────────────────── */
  describe('getAuditLogEntryAction', () => {
    it('happy path: retorna a linha quando existe', async () => {
      __mockSupabase.from.mockReturnValueOnce(makeMaybeSingleMock({ data: SAMPLE_ROW, error: null }));

      const result = await getAuditLogEntryAction(SAMPLE_ROW.id);
      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.id).toBe(SAMPLE_ROW.id);
        expect(result.data.action).toBe('org.suspend');
      }
    });

    it('id inválido (não-uuid) → audit_entry_not_found sem tocar DB', async () => {
      const result = await getAuditLogEntryAction('not-a-uuid');
      expect(result.success).toBe(false);
      expect(result.error).toBe('audit_entry_not_found');
      expect(__mockSupabase.from).not.toHaveBeenCalled();
    });

    it('linha não existe → audit_entry_not_found', async () => {
      __mockSupabase.from.mockReturnValueOnce(makeMaybeSingleMock({ data: null, error: null }));

      const result = await getAuditLogEntryAction(VALID_UUID_3);
      expect(result.success).toBe(false);
      expect(result.error).toBe('audit_entry_not_found');
    });

    it('billing pedindo slug fora-do-escopo → audit_entry_not_found (defesa por obscuridade)', async () => {
      vi.mocked(requirePlatformAdmin).mockResolvedValueOnce(FAKE_BILLING);
      const queryMock = makeMaybeSingleMock({ data: null, error: null });
      __mockSupabase.from.mockReturnValueOnce(queryMock);

      const result = await getAuditLogEntryAction(VALID_UUID_2);
      expect(result.success).toBe(false);
      expect(result.error).toBe('audit_entry_not_found');
      expect(queryMock.or).toHaveBeenCalled();
    });

    it('erro de DB → mensagem genérica', async () => {
      __mockSupabase.from.mockReturnValueOnce(makeMaybeSingleMock({ data: null, error: { message: 'fail' } }));

      const result = await getAuditLogEntryAction(VALID_UUID_1);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Erro interno. Tente novamente.');
    });
  });

  /* ──────────────────────────── searchAuditActorsAction ─────────────────── */
  describe('searchAuditActorsAction', () => {
    it('rejeita query <2 chars (Zod) sem chamar Supabase', async () => {
      const result = await searchAuditActorsAction('a');
      expect(result.success).toBe(false);
      expect(__mockSupabase.from).not.toHaveBeenCalled();
    });

    it('happy path: retorna até 10 atores distintos com dedupe por actor_profile_id', async () => {
      const rows = [
        { actor_profile_id: 'p1', actor_email_snapshot: 'a@x.com', occurred_at: '2026-04-28T12:00:01Z' },
        { actor_profile_id: 'p1', actor_email_snapshot: 'a@x.com', occurred_at: '2026-04-28T11:00:00Z' },
        { actor_profile_id: 'p2', actor_email_snapshot: 'b@x.com', occurred_at: '2026-04-28T10:00:00Z' },
      ];
      __mockSupabase.from.mockReturnValueOnce(makeSearchActorsMock(rows));

      const result = await searchAuditActorsAction('xy');
      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0].actorProfileId).toBe('p1');
        expect(result.data[1].actorProfileId).toBe('p2');
      }
    });

    it('limita resultados a 10 mesmo quando há mais', async () => {
      const rows = Array.from({ length: 15 }).map((_, i) => ({
        actor_profile_id: `p${i}`,
        actor_email_snapshot: `e${i}@x.com`,
        occurred_at: new Date(Date.UTC(2026, 3, 28, 12, 0, i)).toISOString(),
      }));
      __mockSupabase.from.mockReturnValueOnce(makeSearchActorsMock(rows));

      const result = await searchAuditActorsAction('xy');
      expect(result.success).toBe(true);
      if (result.success && result.data) expect(result.data).toHaveLength(10);
    });

    it('erro de DB → mensagem genérica', async () => {
      const q: Record<string, ReturnType<typeof vi.fn>> = {};
      for (const m of ['select', 'not', 'ilike', 'order']) q[m] = vi.fn().mockReturnValue(q);
      (q as unknown as { limit: ReturnType<typeof vi.fn> }).limit = vi.fn().mockResolvedValue({ data: null, error: { message: 'fail' } });
      __mockSupabase.from.mockReturnValueOnce(q);

      const result = await searchAuditActorsAction('xy');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Erro interno. Tente novamente.');
    });
  });

  /* ──────────────────────────── getAuditActionRegistryAction ────────────── */
  describe('getAuditActionRegistryAction', () => {
    it('retorna registry estático sem consultar DB', async () => {
      const result = await getAuditActionRegistryAction();
      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.registry['org.*']).toContain('org.suspend');
        expect(result.data.registry['break_glass.*']).toContain('break_glass.recover_owner');
        expect(result.data.palette['auth.login_rate_limited']).toBe('danger');
        expect(result.data.palette['auth.login_admin_success']).toBe('neutral');
      }
      expect(__mockSupabase.from).not.toHaveBeenCalled();
    });
  });

  /* ──────────────────────────── auth check (notFound) ───────────────────── */
  describe('auth check', () => {
    it('listAuditLogAction: requirePlatformAdmin lança → erro genérico', async () => {
      vi.mocked(requirePlatformAdmin).mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
      const result = await listAuditLogAction({});
      expect(result.success).toBe(false);
    });

    it('getAuditLogEntryAction: requirePlatformAdmin lança → erro genérico', async () => {
      vi.mocked(requirePlatformAdmin).mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
      const result = await getAuditLogEntryAction(VALID_UUID_1);
      expect(result.success).toBe(false);
    });

    it('searchAuditActorsAction: requirePlatformAdmin lança → erro genérico', async () => {
      vi.mocked(requirePlatformAdmin).mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
      const result = await searchAuditActorsAction('xy');
      expect(result.success).toBe(false);
    });
  });
});
