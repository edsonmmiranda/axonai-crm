import { LayoutDashboard } from 'lucide-react';

import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';
import { AdminShell } from '@/components/admin/AdminShell';

export const metadata = { title: 'Axon Admin — Dashboard' };

export default async function AdminDashboardPage() {
  const admin = await requirePlatformAdmin();

  return (
    <AdminShell admin={admin}>
      <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-4 text-center">
        <div className="bg-surface-sunken rounded-full size-16 flex items-center justify-center border border-border">
          <LayoutDashboard className="size-8 text-text-muted" />
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-text-primary">Dashboard em construção</h1>
          <p className="text-sm text-text-secondary">
            KPIs e métricas da plataforma estarão disponíveis no Sprint 09.
          </p>
        </div>
      </div>
    </AdminShell>
  );
}
