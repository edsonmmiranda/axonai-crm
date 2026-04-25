import { LayoutDashboard } from 'lucide-react';

import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';
import { AdminShell } from '@/components/admin/AdminShell';

export const metadata = { title: 'Axon Admin — Dashboard' };

export default async function AdminDashboardPage() {
  const admin = await requirePlatformAdmin();

  return (
    <AdminShell admin={admin}>
      <div className="mr-auto flex max-w-page flex-col gap-6 pb-10">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">Dashboard</h2>
          <p className="max-w-2xl text-text-secondary">
            Visão geral da plataforma Axon AI.
          </p>
        </div>

        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-surface-raised p-12 text-center shadow-sm">
          <div className="bg-surface-sunken rounded-full size-16 flex items-center justify-center border border-border">
            <LayoutDashboard className="size-8 text-text-muted" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-text-primary">Métricas em construção</h3>
            <p className="max-w-md text-sm text-text-secondary">
              KPIs e métricas operacionais da plataforma estarão disponíveis no Sprint 09.
            </p>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
