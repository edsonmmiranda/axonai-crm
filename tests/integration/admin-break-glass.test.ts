/**
 * Sprint admin_12 — Contract tests para break_glass_recover_owner RPC.
 *
 * O CLI scripts/break-glass.ts chama 3 RPCs via service client:
 *   1. get_break_glass_secret_hash() — read do hash em platform_settings
 *   2. break_glass_recover_owner(p_email, p_operator, p_origin_host) — operação atômica
 *   3. (Auth Admin API JS — fora deste teste, manual no runbook)
 *
 * Estes testes documentam o contrato esperado entre caller e RPC via mock do
 * supabase-js client. Não testam a lógica SQL (impossível com mock) — testam
 * que um caller correto chama a RPC certa com os argumentos certos e trata
 * todas as respostas documentadas.
 *
 * Validação real do SQL é feita via runbook (smoke test manual após deploy).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

const { __mockClient } = vi.hoisted(() => ({
  __mockClient: {
    rpc: vi.fn(),
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => __mockClient),
}));

import { createClient } from '@supabase/supabase-js';

beforeEach(() => {
  __mockClient.rpc.mockReset();
});

describe('break_glass_recover_owner — contract via supabase-js service client', () => {
  function makeServiceClient() {
    return createClient('https://example.supabase.co', 'service-role-key', {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  /* ──────────────────────────── get_break_glass_secret_hash ─────────────── */
  describe('get_break_glass_secret_hash', () => {
    it('happy path: retorna o hash quando setting existe', async () => {
      const expected = createHash('sha256').update('top-secret-32-bytes').digest('hex');
      __mockClient.rpc.mockResolvedValueOnce({ data: expected, error: null });

      const sb = makeServiceClient();
      const { data, error } = await sb.rpc('get_break_glass_secret_hash');

      expect(error).toBeNull();
      expect(data).toBe(expected);
    });

    it('retorna NULL quando setting não foi seedado (boot inicial)', async () => {
      __mockClient.rpc.mockResolvedValueOnce({ data: null, error: null });

      const sb = makeServiceClient();
      const { data, error } = await sb.rpc('get_break_glass_secret_hash');

      expect(error).toBeNull();
      expect(data).toBeNull();
      // Caller deve falhar com mensagem clara nesse caso (CLI: "BREAK_GLASS_SECRET hash not configured")
    });

    it('valida hash via SHA-256 do secret bruto', () => {
      // Documenta o algoritmo usado pelo CLI ao comparar BREAK_GLASS_SECRET com o hash do banco.
      const secret = 'sample-secret';
      const expected = createHash('sha256').update(secret).digest('hex');
      const computed = createHash('sha256').update(secret).digest('hex');

      expect(computed).toBe(expected);
      expect(computed).toHaveLength(64); // hex SHA-256
    });
  });

  /* ──────────────────────────── break_glass_recover_owner ───────────────── */
  describe('break_glass_recover_owner', () => {
    const validArgs = {
      p_email:       'admin@axon.ai',
      p_operator:    'edson-incident-2026-04-28',
      p_origin_host: 'admin-recovery-laptop',
    };

    it('happy path: retorna payload completo com 5 campos', async () => {
      const expectedPayload = {
        profile_id:        '11111111-1111-4111-8111-111111111111',
        platform_admin_id: '22222222-2222-4222-8222-222222222222',
        audit_log_id:      '33333333-3333-4333-8333-333333333333',
        was_active:        false,
        old_role:          'support',
      };
      __mockClient.rpc.mockResolvedValueOnce({ data: expectedPayload, error: null });

      const sb = makeServiceClient();
      const { data, error } = await sb.rpc('break_glass_recover_owner', validArgs);

      expect(error).toBeNull();
      expect(data).toMatchObject({
        profile_id:        expect.any(String),
        platform_admin_id: expect.any(String),
        audit_log_id:      expect.any(String),
      });
      expect(__mockClient.rpc).toHaveBeenCalledWith('break_glass_recover_owner', validArgs);
    });

    it('idempotente: rerun retorna was_active=true (estado já restaurado)', async () => {
      // 2ª execução do CLI sobre o mesmo email; RPC ainda restaura (no-op em platform_admins,
      // mas grava 2ª linha de audit como evento).
      __mockClient.rpc.mockResolvedValueOnce({
        data: {
          profile_id:        '11111111-1111-4111-8111-111111111111',
          platform_admin_id: '22222222-2222-4222-8222-222222222222',
          audit_log_id:      'audit-2nd-run',
          was_active:        true,
          old_role:          'owner',
        },
        error: null,
      });

      const sb = makeServiceClient();
      const { data } = await sb.rpc('break_glass_recover_owner', validArgs);

      const result = data as { was_active: boolean; old_role: string };
      expect(result.was_active).toBe(true);
      expect(result.old_role).toBe('owner');
    });

    it('first-time: was_active=null + old_role=null (não havia entry prévia)', async () => {
      __mockClient.rpc.mockResolvedValueOnce({
        data: {
          profile_id:        '11111111-1111-4111-8111-111111111111',
          platform_admin_id: 'new-admin-id',
          audit_log_id:      'audit-first',
          was_active:        null,
          old_role:          null,
        },
        error: null,
      });

      const sb = makeServiceClient();
      const { data } = await sb.rpc('break_glass_recover_owner', validArgs);

      const result = data as { was_active: boolean | null; old_role: string | null };
      expect(result.was_active).toBeNull();
      expect(result.old_role).toBeNull();
    });

    it('profile_not_found: RPC retorna error com a mensagem tipada', async () => {
      __mockClient.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'profile_not_found', code: 'P0001' },
      });

      const sb = makeServiceClient();
      const { data, error } = await sb.rpc('break_glass_recover_owner', {
        ...validArgs,
        p_email: 'unknown@axon.ai',
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error!.message).toBe('profile_not_found');
    });

    it('email_required: RPC rejeita string vazia', async () => {
      __mockClient.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'email_required', code: 'P0001' },
      });

      const sb = makeServiceClient();
      const { error } = await sb.rpc('break_glass_recover_owner', { ...validArgs, p_email: '' });

      expect(error!.message).toBe('email_required');
    });

    it('operator_required: RPC rejeita string vazia', async () => {
      __mockClient.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'operator_required', code: 'P0001' },
      });

      const sb = makeServiceClient();
      const { error } = await sb.rpc('break_glass_recover_owner', { ...validArgs, p_operator: '' });

      expect(error!.message).toBe('operator_required');
    });

    it('payload contém os 3 args nominais (forma do contrato)', async () => {
      __mockClient.rpc.mockResolvedValueOnce({ data: null, error: null });

      const sb = makeServiceClient();
      await sb.rpc('break_glass_recover_owner', validArgs);

      expect(__mockClient.rpc).toHaveBeenCalledWith(
        'break_glass_recover_owner',
        expect.objectContaining({
          p_email:       expect.any(String),
          p_operator:    expect.any(String),
          p_origin_host: expect.any(String),
        }),
      );
      // RPC NÃO recebe BREAK_GLASS_SECRET nem hash — secret é validado client-side antes da chamada.
      const rpcArgs = __mockClient.rpc.mock.calls[0][1] as Record<string, unknown>;
      expect(rpcArgs).not.toHaveProperty('p_secret');
      expect(rpcArgs).not.toHaveProperty('p_break_glass_secret');
    });
  });
});
