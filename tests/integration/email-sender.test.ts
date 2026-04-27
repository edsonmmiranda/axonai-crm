import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), getAll: vi.fn(() => []) })),
  headers: vi.fn(() => ({ get: vi.fn().mockReturnValue(null) })),
}));

const { __mockServiceClient, __sendMail, __createTransport, __getEmailCredential } = vi.hoisted(() => ({
  __mockServiceClient: {
    rpc:  vi.fn().mockResolvedValue({ data: null, error: null }),
    from: vi.fn(),
  },
  __sendMail:        vi.fn().mockResolvedValue({ messageId: 'ok' }),
  __createTransport: vi.fn(),
  __getEmailCredential: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => __mockServiceClient),
}));

vi.mock('nodemailer', () => ({
  default:          { createTransport: __createTransport },
  createTransport:  __createTransport,
}));

vi.mock('@/lib/email/getCredential', () => ({
  getEmailCredential: __getEmailCredential,
  EmailNotConfiguredError: class EmailNotConfiguredError extends Error {
    constructor() { super('email_not_configured'); this.name = 'EmailNotConfiguredError'; }
  },
}));

import { sendEmail, type SendEmailPayload } from '@/lib/email/sender';
import { EmailNotConfiguredError } from '@/lib/email/getCredential';

const PLAINTEXT = 'supersecretXYZW';
const FAKE_LOG_ID = 'abc-123';

const BASE_PAYLOAD: SendEmailPayload = {
  kind:    'invitation',
  to:      'admin@example.com',
  subject: 'Você foi convidado',
  html:    '<p>Click aqui</p>',
  text:    'Click aqui',
};

beforeEach(() => {
  __mockServiceClient.rpc.mockReset().mockResolvedValue({ data: { id: FAKE_LOG_ID }, error: null });
  __mockServiceClient.from.mockReset();
  __sendMail.mockReset().mockResolvedValue({ messageId: 'ok' });
  __createTransport.mockReset().mockReturnValue({ sendMail: __sendMail });
  __getEmailCredential.mockReset();
});

describe('sendEmail — credencial via DB (platform_setting)', () => {
  it('happy — envia via SMTP, log com source=platform_setting status=sent', async () => {
    __getEmailCredential.mockResolvedValue({
      source:        'platform_setting',
      transport:     'smtp',
      host:          'smtp.example.com',
      port:          587,
      user:          'noreply@x.com',
      secure:        false,
      fromEmail:     'noreply@x.com',
      password:      PLAINTEXT,
      credentialId:  'cred-1',
    });

    const result = await sendEmail(BASE_PAYLOAD);

    expect(result.status).toBe('sent');
    expect(__createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.com',
      port: 587,
      auth: { user: 'noreply@x.com', pass: PLAINTEXT },
    }));
    expect(__sendMail).toHaveBeenCalled();
    expect(__mockServiceClient.rpc).toHaveBeenCalledWith(
      'log_email_delivery',
      expect.objectContaining({ p_source: 'platform_setting', p_status: 'sent' }),
    );
    // G-14: plaintext NÃO aparece no return.
    expect(JSON.stringify(result)).not.toContain(PLAINTEXT);
  });

  it('SMTP falha — log com status=error e error_message truncado a 1000 chars', async () => {
    const longError = 'X'.repeat(2000);
    __getEmailCredential.mockResolvedValue({
      source: 'platform_setting', transport: 'smtp',
      host: 'h', port: 587, user: 'u', secure: false, fromEmail: 'f@x.com',
      password: PLAINTEXT, credentialId: 'c',
    });
    __sendMail.mockRejectedValue(new Error(longError));

    const result = await sendEmail(BASE_PAYLOAD);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.errorMessage.length).toBeLessThanOrEqual(1000);
    }
    expect(__mockServiceClient.rpc).toHaveBeenCalledWith(
      'log_email_delivery',
      expect.objectContaining({ p_status: 'error', p_source: 'platform_setting' }),
    );
  });
});

describe('sendEmail — credencial via env vars', () => {
  it('happy — DB sem credencial, env presentes → source=env_var status=sent', async () => {
    __getEmailCredential.mockResolvedValue({
      source: 'env_var', transport: 'smtp',
      host: 'env.smtp', port: 587, user: 'envuser', secure: false, fromEmail: 'envfrom@x.com',
      password: 'envpass', credentialId: null,
    });

    const result = await sendEmail(BASE_PAYLOAD);

    expect(result.status).toBe('sent');
    expect(__mockServiceClient.rpc).toHaveBeenCalledWith(
      'log_email_delivery',
      expect.objectContaining({ p_source: 'env_var', p_status: 'sent' }),
    );
  });
});

describe('sendEmail — fallback offline', () => {
  it('happy — DB+env vazios, fallback ativo, caller passa offlineLink → status=fallback_offline', async () => {
    __getEmailCredential.mockResolvedValue(null);

    const result = await sendEmail({
      ...BASE_PAYLOAD,
      offlineLink: 'https://app.example.com/admin/accept-invite/token-xyz',
    });

    expect(result.status).toBe('fallback_offline');
    if (result.status === 'fallback_offline') {
      expect(result.offlineLink).toBe('https://app.example.com/admin/accept-invite/token-xyz');
    }
    expect(__mockServiceClient.rpc).toHaveBeenCalledWith(
      'log_email_delivery',
      expect.objectContaining({ p_source: 'offline_fallback', p_status: 'fallback_offline' }),
    );
    expect(__sendMail).not.toHaveBeenCalled();
  });

  it('caller esquece offlineLink quando fallback ativo → throw sender_misuse', async () => {
    __getEmailCredential.mockResolvedValue(null);
    await expect(sendEmail(BASE_PAYLOAD)).rejects.toThrow(/sender_misuse/);
  });

  it('fallback desativado e DB+env vazios → EmailNotConfiguredError → status=error', async () => {
    __getEmailCredential.mockRejectedValue(new EmailNotConfiguredError());

    const result = await sendEmail(BASE_PAYLOAD);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.errorMessage).toBe('email_not_configured');
    }
  });
});

describe('sendEmail — G-14 enforcement', () => {
  it('plaintext nunca aparece em response do sender', async () => {
    __getEmailCredential.mockResolvedValue({
      source: 'platform_setting', transport: 'smtp',
      host: 'h', port: 587, user: 'u', secure: false, fromEmail: 'f@x.com',
      password: PLAINTEXT, credentialId: 'c',
    });
    const result = await sendEmail(BASE_PAYLOAD);
    expect(JSON.stringify(result)).not.toContain(PLAINTEXT);
  });

  it('plaintext nunca aparece em payload do log_email_delivery RPC', async () => {
    __getEmailCredential.mockResolvedValue({
      source: 'platform_setting', transport: 'smtp',
      host: 'h', port: 587, user: 'u', secure: false, fromEmail: 'f@x.com',
      password: PLAINTEXT, credentialId: 'c',
    });
    await sendEmail(BASE_PAYLOAD);
    const rpcCalls = __mockServiceClient.rpc.mock.calls;
    for (const [, params] of rpcCalls) {
      const json = JSON.stringify(params);
      expect(json).not.toContain(PLAINTEXT);
    }
  });

  it('caller passa related entity → log inclui o vínculo', async () => {
    __getEmailCredential.mockResolvedValue({
      source: 'platform_setting', transport: 'smtp',
      host: 'h', port: 587, user: 'u', secure: false, fromEmail: 'f@x.com',
      password: 'p', credentialId: 'c',
    });
    await sendEmail({
      ...BASE_PAYLOAD,
      related: { type: 'platform_admin_invitation', id: 'inv-uuid-1' },
    });
    expect(__mockServiceClient.rpc).toHaveBeenCalledWith(
      'log_email_delivery',
      expect.objectContaining({
        p_related_entity_type: 'platform_admin_invitation',
        p_related_entity_id:   'inv-uuid-1',
      }),
    );
  });
});
