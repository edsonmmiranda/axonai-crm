import type { ReactNode } from 'react';

import { getSessionContext } from '@/lib/supabase/getSessionContext';
import { SettingsSidebar } from '@/components/settings/SettingsSidebar';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const session = await getSessionContext();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:flex-row md:gap-8 md:px-6">
      <aside className="md:w-60 md:shrink-0">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-text-primary">Configurações</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Gerencie seu perfil, organização e equipe.
          </p>
        </div>
        <SettingsSidebar role={session.role} />
      </aside>
      <section className="min-w-0 flex-1">{children}</section>
    </div>
  );
}
