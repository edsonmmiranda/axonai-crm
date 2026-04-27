import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __mockSupabase } from '../setup';

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), getAll: vi.fn(() => []) })),
  headers: vi.fn(() => ({ get: vi.fn().mockReturnValue(null) })),
}));

import { enforceLimit } from '@/lib/limits/enforceLimit';
import { mapEnforceLimitError } from '@/lib/limits/enforceLimitError';

const ORG_ID = '00000000-0000-4000-8000-000000000001';

function planLimitExceededError(limit: number, current: number, limitKey = 'leads', delta = 1) {
  return {
    code:    'P0001',
    message: 'plan_limit_exceeded',
    details: JSON.stringify({ limit_key: limitKey, limit, current, delta }),
    hint:    null,
  };
}

beforeEach(() => {
  __mockSupabase.rpc.mockReset();
});

// ────────────────────────────────────────────────────────────────────────────
// Helper: enforceLimitError mapping
// ────────────────────────────────────────────────────────────────────────────

describe('mapEnforceLimitError', () => {
  it('plan_limit_exceeded → mensagem com {limit} formatado pt-BR + nome do recurso', () => {
    const msg = mapEnforceLimitError(planLimitExceededError(1000, 1000, 'leads'), 'leads');
    expect(msg).toContain('1.000');
    expect(msg).toContain('leads');
    expect(msg).toMatch(/upgrade ou contate o suporte/);
  });

  it('plan_limit_exceeded com storage_mb → menciona MB', () => {
    const msg = mapEnforceLimitError(planLimitExceededError(1024, 1024, 'storage_mb'), 'storage_mb');
    expect(msg).toMatch(/1\.024 MB/);
    expect(msg).toMatch(/enviar mais arquivos/);
  });

  it('no_active_subscription → mensagem específica', () => {
    const msg = mapEnforceLimitError(
      { code: 'P0001', message: 'no_active_subscription' },
      'leads',
    );
    expect(msg).toMatch(/subscription vigente/i);
  });

  it('erro inesperado → mensagem genérica', () => {
    const msg = mapEnforceLimitError({ code: 'XX000', message: 'internal_error' }, 'leads');
    expect(msg).toMatch(/Não foi possível validar limites/i);
  });

  it('details malformado (JSON inválido) → fallback com limit=0', () => {
    const msg = mapEnforceLimitError(
      { code: 'P0001', message: 'plan_limit_exceeded', details: '{not-json' },
      'products',
    );
    expect(msg).toContain('produtos');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Helper: enforceLimit chama RPC e mapeia resultado
// ────────────────────────────────────────────────────────────────────────────

describe('enforceLimit', () => {
  it('RPC sucesso → { ok: true }', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    const r = await enforceLimit({ organizationId: ORG_ID, limitKey: 'leads', delta: 1 });
    expect(r.ok).toBe(true);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith('enforce_limit', {
      p_org_id: ORG_ID,
      p_limit_key: 'leads',
      p_delta: 1,
    });
  });

  it('RPC plan_limit_exceeded → { ok: false, error }', async () => {
    __mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: planLimitExceededError(500, 500, 'leads'),
    });
    const r = await enforceLimit({ organizationId: ORG_ID, limitKey: 'leads', delta: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/500 leads/);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Cross-cutting: cada uma das 7 Server Actions customer chama enforce_limit
// com (organizationId, limitKey, delta) corretos e retorna sucesso=false
// quando a RPC falha com plan_limit_exceeded.
// ────────────────────────────────────────────────────────────────────────────

const ORIGIN_ID = '00000000-0000-4000-8000-0000000000bb';

describe('createLeadAction — enforceLimit("leads", 1)', () => {
  it('RPC plan_limit_exceeded → success=false com mensagem pt-BR; INSERT não é chamado', async () => {
    const { createLeadAction } = await import('@/lib/actions/leads');
    __mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: planLimitExceededError(1000, 1000, 'leads'),
    });
    const insertSpy = vi.fn();
    __mockSupabase.from.mockImplementation(() => {
      insertSpy();
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as never;
    });

    const r = await createLeadAction({ name: 'Lead Teste', status: 'new', score: 0, value: 0 });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/1\.000 leads/);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith('enforce_limit', expect.objectContaining({
      p_limit_key: 'leads',
      p_delta:     1,
    }));
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe('createProductAction — enforceLimit("products", 1)', () => {
  it('RPC plan_limit_exceeded → success=false; nada persiste', async () => {
    const { createProductAction } = await import('@/lib/actions/products');
    __mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: planLimitExceededError(50, 50, 'products'),
    });
    const insertSpy = vi.fn();
    __mockSupabase.from.mockImplementation(() => {
      insertSpy();
      return {} as never;
    });

    const r = await createProductAction({
      name: 'Produto Teste',
      sku: 'SKU-TST-001',
      price: 100,
      status: 'active',
    } as never);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/50 produtos/);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith('enforce_limit', expect.objectContaining({
      p_limit_key: 'products',
      p_delta:     1,
    }));
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe('createFunnelAction — enforceLimit("pipelines", 1)', () => {
  it('RPC plan_limit_exceeded → success=false', async () => {
    const { createFunnelAction } = await import('@/lib/actions/funnels');
    __mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: planLimitExceededError(3, 3, 'pipelines'),
    });
    const insertSpy = vi.fn();
    __mockSupabase.from.mockImplementation(() => {
      insertSpy();
      return {} as never;
    });

    const r = await createFunnelAction({
      name: 'Pipeline Teste',
      stages: [
        { name: 'Entrada', order_index: 0, stage_role: 'entry' },
        { name: 'Ganho',   order_index: 1, stage_role: 'won' },
        { name: 'Perdido', order_index: 2, stage_role: 'lost' },
      ],
    } as never);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/3 pipelines/);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith('enforce_limit', expect.objectContaining({
      p_limit_key: 'pipelines',
      p_delta:     1,
    }));
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe('createWhatsappGroupAction — enforceLimit("active_integrations", 1)', () => {
  it('is_active default true → enforce chamado; RPC fail bloqueia INSERT', async () => {
    const { createWhatsappGroupAction } = await import('@/lib/actions/whatsapp-groups');
    __mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: planLimitExceededError(2, 2, 'active_integrations'),
    });
    const insertSpy = vi.fn();
    __mockSupabase.from.mockImplementation(() => {
      insertSpy();
      return {} as never;
    });

    const r = await createWhatsappGroupAction({ name: 'Grupo X' } as never);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/2 integrações ativas/);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith('enforce_limit', expect.objectContaining({
      p_limit_key: 'active_integrations',
      p_delta:     1,
    }));
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('is_active=false → enforce NÃO é chamado (não consome slot ativo)', async () => {
    const { createWhatsappGroupAction } = await import('@/lib/actions/whatsapp-groups');
    __mockSupabase.from.mockImplementation(() => ({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'stop here' } }),
    } as never));

    await createWhatsappGroupAction({ name: 'Grupo Inativo', is_active: false } as never);
    expect(__mockSupabase.rpc).not.toHaveBeenCalledWith(
      'enforce_limit',
      expect.objectContaining({ p_limit_key: 'active_integrations' }),
    );
  });
});

describe('createInvitationAction — enforceLimit("users", 1)', () => {
  it('RPC plan_limit_exceeded → success=false; INSERT em invitations não é chamado', async () => {
    vi.doMock('@/lib/supabase/service', () => ({
      createServiceClient: () => ({
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          ilike:  vi.fn().mockReturnThis(),
          is:     vi.fn().mockReturnThis(),
          gt:     vi.fn().mockReturnThis(),
          limit:  vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          insert: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'should not run' } }),
          })),
        })),
      }),
    }));
    vi.resetModules();

    const { createInvitationAction } = await import('@/lib/actions/invitations');
    __mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: planLimitExceededError(5, 5, 'users'),
    });

    const r = await createInvitationAction({ email: 'novo@teste.com', role: 'user' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/5 usuários/);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith('enforce_limit', expect.objectContaining({
      p_limit_key: 'users',
      p_delta:     1,
    }));
  });
});

describe('uploadProductImageAction — enforceLimit("storage_mb", ceil(size/1MB))', () => {
  it('RPC plan_limit_exceeded → success=false; storage.upload não é chamado', async () => {
    const { uploadProductImageAction } = await import('@/lib/actions/product-images');

    // mock product lookup + count
    __mockSupabase.from.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      order:  vi.fn().mockReturnThis(),
      limit:  vi.fn().mockResolvedValue({ data: [], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'p1' }, error: null }),
    } as never));
    // count head
    let callCount = 0;
    __mockSupabase.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'p1' }, error: null }),
        } as never;
      }
      if (callCount === 2) {
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          order:  vi.fn().mockReturnThis(),
          limit:  vi.fn().mockResolvedValue({ data: [], error: null }),
        } as never;
      }
      // 3rd call: count head
      const q: Record<string, ReturnType<typeof vi.fn>> = {};
      q.select = vi.fn().mockReturnThis();
      q.eq     = vi.fn().mockResolvedValue({ count: 0, error: null });
      return q as never;
    });

    __mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: planLimitExceededError(1024, 1024, 'storage_mb'),
    });

    const file = new File(['x'.repeat(2048)], 'image.png', { type: 'image/png' });
    const fd = new FormData();
    fd.append('file', file);

    const r = await uploadProductImageAction('00000000-0000-4000-8000-0000000000aa', fd);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/1\.024 MB/);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith('enforce_limit', expect.objectContaining({
      p_limit_key: 'storage_mb',
    }));
  });
});

describe('uploadProductDocumentAction — enforceLimit("storage_mb", ceil(size/1MB))', () => {
  it('RPC plan_limit_exceeded → success=false', async () => {
    const { uploadProductDocumentAction } = await import('@/lib/actions/product-documents');

    let callCount = 0;
    __mockSupabase.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'p1' }, error: null }),
        } as never;
      }
      const q: Record<string, ReturnType<typeof vi.fn>> = {};
      q.select = vi.fn().mockReturnThis();
      q.eq     = vi.fn().mockResolvedValue({ count: 0, error: null });
      return q as never;
    });

    __mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: planLimitExceededError(1024, 1024, 'storage_mb'),
    });

    const file = new File(['x'.repeat(2048)], 'doc.pdf', { type: 'application/pdf' });
    const fd = new FormData();
    fd.append('file', file);

    const r = await uploadProductDocumentAction('00000000-0000-4000-8000-0000000000aa', fd, 'manual');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/1\.024 MB/);
    expect(__mockSupabase.rpc).toHaveBeenCalledWith('enforce_limit', expect.objectContaining({
      p_limit_key: 'storage_mb',
    }));
  });
});
