import type { ReactNode } from 'react';

import type { PlatformAdminSnapshot } from '@/lib/auth/platformAdmin';
import { AdminContextBanner } from './AdminContextBanner';
import { AdminSidebar } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';

interface Props {
  admin: PlatformAdminSnapshot;
  children: ReactNode;
}

export function AdminShell({ admin, children }: Props) {
  return (
    <div className="flex flex-col h-screen">
      <AdminContextBanner adminName={admin.email} adminRole={admin.role} />
      <div className="flex flex-1 overflow-hidden">
        <AdminSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <AdminTopbar adminName={admin.email} adminRole={admin.role} />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
