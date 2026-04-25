import type { ReactNode } from 'react';

import type { PlatformAdminSnapshot } from '@/lib/auth/platformAdmin';
import { AdminSidebar } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';

interface Props {
  admin: PlatformAdminSnapshot;
  children: ReactNode;
}

export function AdminShell({ admin, children }: Props) {
  return (
    <div className="h-screen flex overflow-hidden bg-surface-base">
      <AdminSidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden relative bg-surface-base">
        <AdminTopbar admin={admin} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
