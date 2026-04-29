import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), getAll: vi.fn(() => []) })),
  headers: vi.fn(() => ({ get: vi.fn().mockReturnValue(null) })),
}));

const { __mockServiceClient } = vi.hoisted(() => ({
  __mockServiceClient: {
    rpc: vi.fn(),
  },
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => __mockServiceClient),
}));

import { __mockSupabase } from '../setup';
import {
  assertAdminLoginRateLimit,
  recordAdminLoginAttempt,
  RateLimitError,
} from '@/lib/rateLimit/adminLogin';
import { signInAdminAction } from '@/lib/actions/admin/admin-auth';

beforeEach(() => {
  __mockServiceClient.rpc.mockReset();
  __mockServiceClient.rpc.mockResolvedValue({ data: null, error: null });
});

describe('rateLimit/adminLogin helpers', () => {
  /* ──────────────────────────── assertAdminLoginRateLimit ───────────────── */
  describe('assertAdminLoginRateLimit', () => {
    it('passa quando contagens estão abaixo dos limites', async () => {
      __mockServiceClient.rpc.mockResolvedValueOnce({ data: { by_email: 4, by_ip: 19 }, error: null });

      await expect(
        assertAdminLoginRateLimit({ email: 'foo@axon.io', ip: '198.51.100.1', userAgent: null }),
      ).resolves.toBeUndefined();
    });

    it('throw RateLimitError("email") quando by_email atinge 5', async () => {
      __mockServiceClient.rpc
        .mockResolvedValueOnce({ data: { by_email: 5, by_ip: 1 }, error: null })  // count
        .mockResolvedValueOnce({ data: null, error: null });                      // audit emit

      await expect(
        assertAdminLoginRateLimit({ email: 'foo@axon.io', ip: '198.51.100.1', userAgent: null }),
      ).rejects.toThrow(RateLimitError);

      // 2 chamadas: count_admin_login_failures + audit_login_admin_event
      expect(__mockServiceClient.rpc).toHaveBeenCalledTimes(2);
      const auditCall = __mockServiceClient.rpc.mock.calls.find(([rpc]) => rpc === 'audit_login_admin_event');
      expect(auditCall).toBeDefined();
      expect(auditCall![1]).toMatchObject({
        p_action:   'auth.login_rate_limited',
        p_metadata: { scope: 'email', attempts: 5, window_minutes: 10 },
      });
    });

    it('throw RateLimitError("ip") quando by_ip atinge 20 (mas by_email < 5)', async () => {
      __mockServiceClient.rpc
        .mockResolvedValueOnce({ data: { by_email: 2, by_ip: 20 }, error: null })
        .mockResolvedValueOnce({ data: null, error: null });

      await expect(
        assertAdminLoginRateLimit({ email: 'foo@axon.io', ip: '198.51.100.1', userAgent: null }),
      ).rejects.toThrow(RateLimitError);

      const auditCall = __mockServiceClient.rpc.mock.calls.find(([rpc]) => rpc === 'audit_login_admin_event');
      expect(auditCall![1]).toMatchObject({
        p_action:   'auth.login_rate_limited',
        p_metadata: { scope: 'ip', attempts: 20, window_minutes: 10 },
      });
    });

    it('email scope precede IP quando ambos estouram (ordem do código)', async () => {
      __mockServiceClient.rpc
        .mockResolvedValueOnce({ data: { by_email: 7, by_ip: 25 }, error: null })
        .mockResolvedValueOnce({ data: null, error: null });

      try {
        await assertAdminLoginRateLimit({ email: 'foo@axon.io', ip: '198.51.100.1', userAgent: null });
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        expect((err as RateLimitError).scope).toBe('email');
      }
    });

    it('fail-closed: DB error em count → throw RateLimitError("db_unavailable")', async () => {
      __mockServiceClient.rpc.mockResolvedValueOnce({ data: null, error: { message: 'connection lost' } });

      try {
        await assertAdminLoginRateLimit({ email: 'foo@axon.io', ip: '198.51.100.1', userAgent: null });
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        expect((err as RateLimitError).scope).toBe('db_unavailable');
      }
    });

    it('chama RPC count_admin_login_failures com p_window="10 minutes"', async () => {
      __mockServiceClient.rpc.mockResolvedValueOnce({ data: { by_email: 0, by_ip: 0 }, error: null });

      await assertAdminLoginRateLimit({ email: 'foo@axon.io', ip: '198.51.100.1', userAgent: 'UA' });

      expect(__mockServiceClient.rpc).toHaveBeenCalledWith('count_admin_login_failures', {
        p_email:  'foo@axon.io',
        p_ip:     '198.51.100.1',
        p_window: '10 minutes',
      });
    });
  });

  /* ──────────────────────────── recordAdminLoginAttempt ─────────────────── */
  describe('recordAdminLoginAttempt', () => {
    it('chama RPC record_admin_login_attempt com argumentos corretos', async () => {
      await recordAdminLoginAttempt({
        email:     'foo@axon.io',
        ip:        '198.51.100.1',
        userAgent: 'Mozilla/5.0',
        success:   true,
      });

      expect(__mockServiceClient.rpc).toHaveBeenCalledWith('record_admin_login_attempt', {
        p_email:      'foo@axon.io',
        p_ip:         '198.51.100.1',
        p_user_agent: 'Mozilla/5.0',
        p_success:    true,
      });
    });

    it('fail-open: erro de DB NÃO propaga (login não pode quebrar por log perdido)', async () => {
      __mockServiceClient.rpc.mockResolvedValueOnce({ data: null, error: { message: 'fail' } });

      await expect(
        recordAdminLoginAttempt({ email: 'foo@axon.io', ip: '198.51.100.1', userAgent: null, success: false }),
      ).resolves.toBeUndefined();
    });

    it('fail-open: throw inesperado em rpc tampouco propaga', async () => {
      __mockServiceClient.rpc.mockRejectedValueOnce(new Error('boom'));

      await expect(
        recordAdminLoginAttempt({ email: 'foo@axon.io', ip: '198.51.100.1', userAgent: null, success: false }),
      ).resolves.toBeUndefined();
    });
  });
});

describe('signInAdminAction', () => {
  // ──────── helper para mockar o auth wrapper do supabase server client ────────
  function setupAuthMock(opts: {
    signInError?:    { message: string } | null;
    aalNextLevel?:   'aal1' | 'aal2';
  } = {}) {
    const signInMock = vi.fn().mockResolvedValue({ data: null, error: opts.signInError ?? null });
    const aalMock    = vi.fn().mockResolvedValue({
      data:  { currentLevel: 'aal1' as const, nextLevel: opts.aalNextLevel ?? 'aal1' },
      error: null,
    });
    Object.assign(__mockSupabase, {
      auth: {
        ...__mockSupabase.auth,
        signInWithPassword: signInMock,
        mfa: { getAuthenticatorAssuranceLevel: aalMock },
      },
    });
    return { signInMock, aalMock };
  }

  it('happy path: rate-limit OK + signIn OK → success com redirectTo /admin/mfa-enroll', async () => {
    __mockServiceClient.rpc
      .mockResolvedValueOnce({ data: { by_email: 0, by_ip: 0 }, error: null }) // count (assert)
      .mockResolvedValueOnce({ data: null,                      error: null }) // record success
      .mockResolvedValueOnce({ data: 'audit-uuid',              error: null }); // audit success
    setupAuthMock({ signInError: null, aalNextLevel: 'aal1' });

    const result = await signInAdminAction({ email: 'foo@axon.io', password: 'pass1234' });

    expect(result.success).toBe(true);
    if (result.success && result.data) expect(result.data.redirectTo).toBe('/admin/mfa-enroll');

    // Audit success foi emitido
    const auditCall = __mockServiceClient.rpc.mock.calls.find(([rpc]) => rpc === 'audit_login_admin_event');
    expect(auditCall![1]).toMatchObject({ p_action: 'auth.login_admin_success' });
  });

  it('aal2 → redirectTo /admin/mfa-challenge', async () => {
    __mockServiceClient.rpc
      .mockResolvedValueOnce({ data: { by_email: 0, by_ip: 0 }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: 'audit-uuid', error: null });
    setupAuthMock({ signInError: null, aalNextLevel: 'aal2' });

    const result = await signInAdminAction({ email: 'foo@axon.io', password: 'pass1234' });

    expect(result.success).toBe(true);
    if (result.success && result.data) expect(result.data.redirectTo).toBe('/admin/mfa-challenge');
  });

  it('rate limit triggera ANTES do signIn — mensagem genérica', async () => {
    __mockServiceClient.rpc
      .mockResolvedValueOnce({ data: { by_email: 5, by_ip: 1 }, error: null })  // assert: limite estourado
      .mockResolvedValueOnce({ data: null, error: null });                       // audit rate_limited
    const { signInMock } = setupAuthMock();

    const result = await signInAdminAction({ email: 'foo@axon.io', password: 'pass1234' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Muitas tentativas. Aguarde alguns minutos.');
    // signInWithPassword NÃO foi chamado (fail-closed, ANTES do auth)
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('credenciais inválidas → record(success=false), erro genérico, sem audit_login_admin_success', async () => {
    __mockServiceClient.rpc
      .mockResolvedValueOnce({ data: { by_email: 0, by_ip: 0 }, error: null })  // assert
      .mockResolvedValueOnce({ data: null, error: null });                       // record
    setupAuthMock({ signInError: { message: 'Invalid login credentials' } });

    const result = await signInAdminAction({ email: 'foo@axon.io', password: 'wrong' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('E-mail ou senha incorretos.');

    const successAudit = __mockServiceClient.rpc.mock.calls.find(([rpc, args]) =>
      rpc === 'audit_login_admin_event' && (args as { p_action: string }).p_action === 'auth.login_admin_success',
    );
    expect(successAudit).toBeUndefined();
  });

  it('email não confirmado → mensagem específica', async () => {
    __mockServiceClient.rpc
      .mockResolvedValueOnce({ data: { by_email: 0, by_ip: 0 }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    setupAuthMock({ signInError: { message: 'Email not confirmed' } });

    const result = await signInAdminAction({ email: 'foo@axon.io', password: 'pass1234' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Confirme seu e-mail antes de continuar.');
  });

  it('Zod: email inválido → erro genérico, sem chamar nada', async () => {
    const result = await signInAdminAction({ email: 'not-an-email', password: 'pass1234' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('E-mail ou senha incorretos.');
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });

  it('Zod: password vazio → erro genérico, sem chamar nada', async () => {
    const result = await signInAdminAction({ email: 'foo@axon.io', password: '' });

    expect(result.success).toBe(false);
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });

  it('email é normalizado para lowercase ao chamar rate limit + record', async () => {
    __mockServiceClient.rpc
      .mockResolvedValueOnce({ data: { by_email: 0, by_ip: 0 }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: 'audit-uuid', error: null });
    setupAuthMock({ signInError: null });

    await signInAdminAction({ email: 'FOO@Axon.IO', password: 'pass1234' });

    const countCall = __mockServiceClient.rpc.mock.calls.find(([rpc]) => rpc === 'count_admin_login_failures');
    expect((countCall![1] as { p_email: string }).p_email).toBe('foo@axon.io');

    const recordCall = __mockServiceClient.rpc.mock.calls.find(([rpc]) => rpc === 'record_admin_login_attempt');
    expect((recordCall![1] as { p_email: string }).p_email).toBe('foo@axon.io');
  });

  it('fail-closed: DB indisponível no assert → erro genérico, sem signIn', async () => {
    __mockServiceClient.rpc.mockResolvedValueOnce({ data: null, error: { message: 'connection lost' } });
    const { signInMock } = setupAuthMock();

    const result = await signInAdminAction({ email: 'foo@axon.io', password: 'pass1234' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Muitas tentativas. Aguarde alguns minutos.');
    expect(signInMock).not.toHaveBeenCalled();
  });
});
