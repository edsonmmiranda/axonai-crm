import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), getAll: vi.fn(() => []) })),
  headers: vi.fn(() => ({ get: vi.fn().mockReturnValue(null) })),
}));

const { __mockClient } = vi.hoisted(() => ({
  __mockClient: { from: vi.fn() },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(__mockClient)),
}));

import { getEmailSourceStatus } from '@/lib/email/getEmailSourceStatus';

function makeQueries(credCount: number, fallbackEnabled: boolean | null) {
  const credQ: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select','eq'] as const) credQ[m] = vi.fn().mockReturnValue(credQ);
  credQ.is = vi.fn().mockResolvedValue({ count: credCount, error: null });

  const settingQ: Record<string, ReturnType<typeof vi.fn>> = {};
  settingQ.select = vi.fn().mockReturnValue(settingQ);
  settingQ.eq     = vi.fn().mockReturnValue(settingQ);
  settingQ.maybeSingle = vi.fn().mockResolvedValue({
    data: fallbackEnabled === null ? null : { value_bool: fallbackEnabled },
    error: null,
  });

  return { credQ, settingQ };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BOOTSTRAP_EMAIL_HOST     = '';
  process.env.BOOTSTRAP_EMAIL_USER     = '';
  process.env.BOOTSTRAP_EMAIL_PASSWORD = '';
  // Limpa o cache do React `cache()` re-importando o módulo. Cada teste roda
  // em isolamento via vi.resetModules quando necessário.
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('getEmailSourceStatus', () => {
  it('DB tem credencial ativa → platformSetting=true', async () => {
    const { credQ, settingQ } = makeQueries(1, true);
    __mockClient.from
      .mockReturnValueOnce(credQ)     // platform_integration_credentials
      .mockReturnValueOnce(settingQ); // platform_settings

    const { getEmailSourceStatus: fresh } = await import('@/lib/email/getEmailSourceStatus');
    const status = await fresh();

    expect(status.platformSetting).toBe(true);
    expect(status.envVar).toBe(false);
    expect(status.offlineFallback).toBe(true);
  });

  it('DB sem credenciais ativas → platformSetting=false', async () => {
    const { credQ, settingQ } = makeQueries(0, true);
    __mockClient.from.mockReturnValueOnce(credQ).mockReturnValueOnce(settingQ);

    const { getEmailSourceStatus: fresh } = await import('@/lib/email/getEmailSourceStatus');
    const status = await fresh();
    expect(status.platformSetting).toBe(false);
  });

  it('credenciais revogadas (count=0) → platformSetting=false', async () => {
    // Equivalente ao caso anterior — count=0 já significa "sem ativa" pela query is(revoked_at, null).
    const { credQ, settingQ } = makeQueries(0, false);
    __mockClient.from.mockReturnValueOnce(credQ).mockReturnValueOnce(settingQ);

    const { getEmailSourceStatus: fresh } = await import('@/lib/email/getEmailSourceStatus');
    const status = await fresh();
    expect(status.platformSetting).toBe(false);
    expect(status.offlineFallback).toBe(false);
  });

  it('env vars HOST+USER+PASSWORD presentes → envVar=true', async () => {
    process.env.BOOTSTRAP_EMAIL_HOST     = 'smtp.env.com';
    process.env.BOOTSTRAP_EMAIL_USER     = 'envuser';
    process.env.BOOTSTRAP_EMAIL_PASSWORD = 'envpass';

    const { credQ, settingQ } = makeQueries(0, true);
    __mockClient.from.mockReturnValueOnce(credQ).mockReturnValueOnce(settingQ);

    const { getEmailSourceStatus: fresh } = await import('@/lib/email/getEmailSourceStatus');
    const status = await fresh();
    expect(status.envVar).toBe(true);
  });

  it('env vars parciais (HOST sem PASSWORD) → envVar=false', async () => {
    process.env.BOOTSTRAP_EMAIL_HOST = 'smtp.env.com';
    // USER e PASSWORD ausentes

    const { credQ, settingQ } = makeQueries(0, true);
    __mockClient.from.mockReturnValueOnce(credQ).mockReturnValueOnce(settingQ);

    const { getEmailSourceStatus: fresh } = await import('@/lib/email/getEmailSourceStatus');
    const status = await fresh();
    expect(status.envVar).toBe(false);
  });

  it('signup_link_offline_fallback_enabled=false → offlineFallback=false', async () => {
    const { credQ, settingQ } = makeQueries(0, false);
    __mockClient.from.mockReturnValueOnce(credQ).mockReturnValueOnce(settingQ);

    const { getEmailSourceStatus: fresh } = await import('@/lib/email/getEmailSourceStatus');
    const status = await fresh();
    expect(status.offlineFallback).toBe(false);
  });

  it('shape consistente — campos sempre boolean', async () => {
    const { credQ, settingQ } = makeQueries(1, true);
    __mockClient.from.mockReturnValueOnce(credQ).mockReturnValueOnce(settingQ);

    const { getEmailSourceStatus: fresh } = await import('@/lib/email/getEmailSourceStatus');
    const status = await fresh();
    expect(typeof status.platformSetting).toBe('boolean');
    expect(typeof status.envVar).toBe('boolean');
    expect(typeof status.offlineFallback).toBe('boolean');
  });
});
