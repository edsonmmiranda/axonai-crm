import type { ReactNode } from 'react';

import { getFunnelsAction } from '@/lib/actions/funnels';
import type { SessionContext } from '@/lib/supabase/getSessionContext';

import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

interface AppLayoutProps {
  children: ReactNode;
  session: SessionContext;
}

export default async function AppLayout({ children, session }: AppLayoutProps) {
  const funnelsRes = await getFunnelsAction({ isActive: true, pageSize: 100 });
  const funnels =
    funnelsRes.success && funnelsRes.data
      ? funnelsRes.data
          .map((f) => ({ id: f.id, name: f.name }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
      : [];

  return (
    <div className="flex h-screen overflow-hidden bg-surface-base text-text-primary">
      <Sidebar organizationName={session.organizationName} funnels={funnels} />
      <div className="relative flex h-full flex-1 flex-col overflow-hidden">
        <Topbar session={session} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
