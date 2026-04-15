import type { ReactNode } from 'react';

import type { SessionContext } from '@/lib/supabase/getSessionContext';

import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

interface AppLayoutProps {
  children: ReactNode;
  session: SessionContext;
}

export default function AppLayout({ children, session }: AppLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-surface-base text-text-primary">
      <Sidebar organizationName={session.organizationName} />
      <div className="relative flex h-full flex-1 flex-col overflow-hidden">
        <Topbar session={session} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
