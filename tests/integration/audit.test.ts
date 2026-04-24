import { describe, it, expect, vi } from 'vitest';
import { __mockSupabase } from '../setup';
import { writeAudit } from '@/lib/audit/write';

describe('writeAudit', () => {
  describe('happy path', () => {
    it('insere linha via audit_write e retorna UUID', async () => {
      const fakeId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      __mockSupabase.rpc.mockResolvedValueOnce({ data: fakeId, error: null });

      const result = await writeAudit({ action: 'org.suspend', targetType: 'organization' });

      expect(__mockSupabase.rpc).toHaveBeenCalledWith(
        'audit_write',
        expect.objectContaining({
          action: 'org.suspend',
          target_type: 'organization',
        })
      );
      expect(result).toBe(fakeId);
    });

    it('passa target_id e target_organization_id quando fornecidos', async () => {
      __mockSupabase.rpc.mockResolvedValueOnce({ data: 'some-uuid', error: null });
      const orgId = 'org-uuid-123';

      await writeAudit({
        action: 'org.suspend',
        targetType: 'organization',
        targetId: orgId,
        targetOrganizationId: orgId,
        metadata: { reason: 'inadimplência' },
      });

      expect(__mockSupabase.rpc).toHaveBeenCalledWith(
        'audit_write',
        expect.objectContaining({
          target_id: orgId,
          target_organization_id: orgId,
          metadata: { reason: 'inadimplência' },
        })
      );
    });

    it('passa null para campos opcionais não fornecidos', async () => {
      __mockSupabase.rpc.mockResolvedValueOnce({ data: 'some-uuid', error: null });

      await writeAudit({ action: 'plan.archive', targetType: 'plan' });

      expect(__mockSupabase.rpc).toHaveBeenCalledWith(
        'audit_write',
        expect.objectContaining({
          target_id: null,
          target_organization_id: null,
          diff_before: null,
          diff_after: null,
          metadata: null,
        })
      );
    });
  });

  describe('extração de IP', () => {
    it('extrai primeiro IP público de x-forwarded-for com chain', async () => {
      __mockSupabase.rpc.mockResolvedValueOnce({ data: 'uuid', error: null });
      const request = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' },
      });

      await writeAudit({ action: 'test', targetType: 'test' }, request);

      expect(__mockSupabase.rpc).toHaveBeenCalledWith(
        'audit_write',
        expect.objectContaining({ ip_address: '203.0.113.1' })
      );
    });

    it('filtra IP privado (RFC 1918) e passa null', async () => {
      __mockSupabase.rpc.mockResolvedValueOnce({ data: 'uuid', error: null });
      const request = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '10.0.0.5' },
      });

      await writeAudit({ action: 'test', targetType: 'test' }, request);

      expect(__mockSupabase.rpc).toHaveBeenCalledWith(
        'audit_write',
        expect.objectContaining({ ip_address: null })
      );
    });

    it('filtra loopback (127.0.0.1) e passa null', async () => {
      __mockSupabase.rpc.mockResolvedValueOnce({ data: 'uuid', error: null });
      const request = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      });

      await writeAudit({ action: 'test', targetType: 'test' }, request);

      expect(__mockSupabase.rpc).toHaveBeenCalledWith(
        'audit_write',
        expect.objectContaining({ ip_address: null })
      );
    });

    it('passa null quando request não é fornecido', async () => {
      __mockSupabase.rpc.mockResolvedValueOnce({ data: 'uuid', error: null });

      await writeAudit({ action: 'test', targetType: 'test' });

      expect(__mockSupabase.rpc).toHaveBeenCalledWith(
        'audit_write',
        expect.objectContaining({ ip_address: null, user_agent: null })
      );
    });

    it('extrai user-agent do request', async () => {
      __mockSupabase.rpc.mockResolvedValueOnce({ data: 'uuid', error: null });
      const request = new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '1.2.3.4',
          'user-agent': 'Mozilla/5.0',
        },
      });

      await writeAudit({ action: 'test', targetType: 'test' }, request);

      expect(__mockSupabase.rpc).toHaveBeenCalledWith(
        'audit_write',
        expect.objectContaining({ user_agent: 'Mozilla/5.0' })
      );
    });
  });

  describe('tratamento de erro', () => {
    it('propaga erro quando bestEffort=false (default)', async () => {
      __mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'connection refused' },
      });

      await expect(
        writeAudit({ action: 'org.suspend', targetType: 'organization' })
      ).rejects.toThrow('audit_write failed: connection refused');
    });

    it('retorna null e não lança quando bestEffort=true', async () => {
      __mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'connection refused' },
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await writeAudit({
        action: 'org.suspend',
        targetType: 'organization',
        bestEffort: true,
      });

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[audit] best-effort write failed:',
        expect.anything()
      );
      consoleSpy.mockRestore();
    });
  });
});
