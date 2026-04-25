import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { notFound } from 'next/navigation';

import { AdminShell } from '@/components/admin/AdminShell';
import { PlanForm } from '@/components/admin/plans/PlanForm';
import { requirePlatformAdminRole } from '@/lib/auth/platformAdmin';
import { getPlanDetailAction } from '@/lib/actions/admin/plans';

export const metadata = { title: 'Axon Admin — Editar plano' };

export default async function EditPlanPage(props: { params: Promise<{ id: string }> }) {
  const admin = await requirePlatformAdminRole(['owner']);
  const { id } = await props.params;

  const res = await getPlanDetailAction(id);
  if (!res.success || !res.data) notFound();
  if (res.data.isArchived) notFound();

  const plan = res.data;

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
            <li className="font-semibold text-text-primary">{plan.name}</li>
          </ol>
        </nav>

        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">Editar {plan.name}</h2>
          <p className="text-text-secondary">{plan.activeSubscriptionsCount} subscription(s) ativa(s) neste plano.</p>
        </div>

        <PlanForm mode="edit" initialData={plan} />
      </div>
    </AdminShell>
  );
}
