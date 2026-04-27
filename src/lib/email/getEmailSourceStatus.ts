import 'server-only';

import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';

export interface EmailSourceStatus {
  platformSetting: boolean;
  envVar:          boolean;
  offlineFallback: boolean;
}

interface SettingRow { value_bool: boolean | null }

export const getEmailSourceStatus = cache(async (): Promise<EmailSourceStatus> => {
  const supabase = await createClient();

  const [credResp, settingResp] = await Promise.all([
    supabase
      .from('platform_integration_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'email_smtp')
      .is('revoked_at', null),
    supabase
      .from('platform_settings')
      .select('value_bool')
      .eq('key', 'signup_link_offline_fallback_enabled')
      .maybeSingle<SettingRow>(),
  ]);

  return {
    platformSetting: (credResp.count ?? 0) > 0,
    envVar: Boolean(
      process.env.BOOTSTRAP_EMAIL_HOST
        && process.env.BOOTSTRAP_EMAIL_USER
        && process.env.BOOTSTRAP_EMAIL_PASSWORD,
    ),
    offlineFallback: settingResp.data?.value_bool === true,
  };
});
