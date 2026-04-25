import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { PlansList } from '@/components/admin/plans/PlansList';
import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';
import { getPlansAction } from '@/lib/actions/admin/plans';

export const metadata = { title: 'Axon Admin — Plans' };

interface SearchParams {
  search?: string;
  archived?: string;
  page?: string;
}

export default async function PlansPage(props: { searchParams: Promise<SearchParams> }) {
  const admin = await requirePlatformAdmin();
  const searchParams = await props.searchParams;

  const search      = searchParams.search?.trim() || undefined;
  const showArchived = searchParams.archived === 'true';
  const page        = Math.max(1, Number(searchParams.page) || 1);

  const res = await getPlansAction({ search, isArchived: showArchived, page, pageSize: 25 });
  const plans    = res.success ? (res.data ?? []) : [];
  const total    = res.metadata?.total ?? 0;

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
            <li className="font-semibold text-text-primary">Plans</li>
          </ol>
        </nav>

        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">Planos</h2>
          <p className="text-text-secondary">Gerencie o catálogo de planos da plataforma.</p>
        </div>

        <PlansList
          plans={plans}
          total={total}
          page={page}
          pageSize={25}
          search={search ?? ''}
          showArchived={showArchived}
          adminRole={admin.role}
        />
      </div>
    </AdminShell>
  );
}
