import 'server-only';

import { cache } from 'react';

import { createServiceClient } from '@/lib/supabase/service';

export interface SmtpCredential {
  source:        'platform_setting' | 'env_var';
  transport:     'smtp';
  host:          string;
  port:          number;
  user:          string;
  secure:        boolean;
  fromEmail:     string;
  password:      string;
  credentialId:  string | null;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('email_not_configured');
    this.name = 'EmailNotConfiguredError';
  }
}

interface PlaintextRow {
  plaintext:     string;
  metadata:      Record<string, unknown>;
  credential_id: string;
}

interface SettingRow { value_bool: boolean | null }

export const getEmailCredential = cache(async (): Promise<SmtpCredential | null> => {
  const supabase = createServiceClient();

  // Nível 1: DB via Vault.
  const plaintextResp = await supabase.rpc('get_integration_credential_plaintext', { p_kind: 'email_smtp' });
  const rows = plaintextResp.data as PlaintextRow[] | null;
  if (!plaintextResp.error && rows && rows.length > 0) {
    const row = rows[0];
    const meta = row.metadata ?? {};

    void supabase.rpc('mark_credential_used', { p_credential_id: row.credential_id });

    return {
      source:        'platform_setting',
      transport:     'smtp',
      host:          String(meta.host ?? ''),
      port:          Number(meta.port ?? 587),
      user:          String(meta.user ?? ''),
      secure:        Boolean(meta.secure ?? false),
      fromEmail:     String(meta.fromEmail ?? meta.user ?? ''),
      password:      row.plaintext,
      credentialId:  row.credential_id,
    };
  }

  // Nível 2: env vars.
  const host = process.env.BOOTSTRAP_EMAIL_HOST;
  const user = process.env.BOOTSTRAP_EMAIL_USER;
  const pass = process.env.BOOTSTRAP_EMAIL_PASSWORD;
  if (host && user && pass) {
    return {
      source:        'env_var',
      transport:     'smtp',
      host,
      port:          Number(process.env.BOOTSTRAP_EMAIL_PORT ?? 587),
      user,
      secure:        process.env.BOOTSTRAP_EMAIL_SECURE === 'true',
      fromEmail:     process.env.BOOTSTRAP_EMAIL_FROM ?? user,
      password:      pass,
      credentialId:  null,
    };
  }

  // Nível 3: setting offline fallback.
  const settingResp = await supabase
    .from('platform_settings')
    .select('value_bool')
    .eq('key', 'signup_link_offline_fallback_enabled')
    .maybeSingle<SettingRow>();
  if (settingResp.data?.value_bool === true) return null;

  throw new EmailNotConfiguredError();
});
