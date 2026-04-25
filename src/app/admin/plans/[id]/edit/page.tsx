import Link from 'next/link';
import { Calendar, ChevronRight, Clock, Users } from 'lucide-react';
import { notFound } from 'next/navigation';

import { AdminShell } from '@/components/admin/AdminShell';
import { PlanForm } from '@/components/admin/plans/PlanForm';
import { PlanStatusBadge } from '@/components/admin/plans/PlanStatusBadge';
import { requirePlatformAdminRole } from '@/lib/auth/platformAdmin';
import { getPlanDetailAction } from '@/lib/actions/admin/plans';

export const metadata = { title: 'Axon Admin — Editar plano' };

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

export default async function EditPlanPage(props: { params: Promise<{ id: string }> }) {
  const admin = await requirePlatformAdminRole(['owner']);
  const { id } = await props.params;

  const res = await getPlanDetailAction(id);
  if (!res.success || !res.data) notFound();
  if (res.data.isArchived) notFound();

  const plan = res.data;
  const createdAt = dateFormatter.format(new Date(plan.createdAt));
  const updatedAt = dateFormatter.format(new Date(plan.updatedAt));

  return (
    <AdminShell admin={admin}>
      <div className="mr-auto flex max-w-4xl flex-col gap-6 pb-10">
        <nav className="flex text-sm font-medium text-text-secondary" aria-label="breadcrumb">
          <ol className="flex items-center gap-2">
            <li>
              <Link
                href="/admin/dashboard"
                className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
              >
                Dashboard
              </Link>
            </li>
            <li aria-hidden="true"><ChevronRight className="size-4 text-text-muted" /></li>
            <li>
              <Link
                href="/admin/plans"
                className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
              >
                Plans
              </Link>
            </li>
            <li aria-hidden="true"><ChevronRight className="size-4 text-text-muted" /></li>
            <li className="font-semibold text-text-primary">{plan.name}</li>
          </ol>
        </nav>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
              Editar {plan.name}
            </h2>
            <PlanStatusBadge isArchived={plan.isArchived} isPublic={plan.isPublic} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-secondary">
            <span className="flex items-center gap-1.5">
              <Users className="size-3.5" aria-hidden="true" />
              {plan.activeSubscriptionsCount} subscription(s) ativa(s)
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="size-3.5" aria-hidden="true" />
              Criado em {createdAt}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="size-3.5" aria-hidden="true" />
              Atualizado em {updatedAt}
            </span>
          </div>
        </div>

        <PlanForm mode="edit" initialData={plan} />
      </div>
    </AdminShell>
  );
}
