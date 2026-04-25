import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { PlanForm } from '@/components/admin/plans/PlanForm';
import { requirePlatformAdminRole } from '@/lib/auth/platformAdmin';

export const metadata = { title: 'Axon Admin — Novo plano' };

export default async function NewPlanPage() {
  const admin = await requirePlatformAdminRole(['owner']);

  return (
    <AdminShell admin={admin}>
      <div className="mr-auto flex max-w-page flex-col gap-6 pb-10">
        <nav className="flex text-sm font-medium text-text-secondary" aria-label="breadcrumb">
          <ol className="flex items-center gap-2">
            <li>
              <Link href="/admin/dashboard" className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus">
                Dashboard
              </Link>
            </li>
            <li aria-hidden="true"><ChevronRight className="size-4 text-text-muted" /></li>
            <li>
              <Link href="/admin/plans" className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus">
                Plans
              </Link>
            </li>
            <li aria-hidden="true"><ChevronRight className="size-4 text-text-muted" /></li>
            <li className="font-semibold text-text-primary">Novo plano</li>
          </ol>
        </nav>

        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">Criar plano</h2>
          <p className="text-text-secondary">Defina preços e limites para o novo plano.</p>
        </div>

        <PlanForm mode="create" />
      </div>
    </AdminShell>
  );
}
