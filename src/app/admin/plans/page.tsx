import Link from 'next/link';
import { ChevronRight, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { AdminShell } from '@/components/admin/AdminShell';
import { PlansList } from '@/components/admin/plans/PlansList';
import { PlansToolbar } from '@/components/admin/plans/PlansToolbar';
import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';
import { getPlansAction } from '@/lib/actions/admin/plans';

export const metadata = { title: 'Axon Admin — Plans' };

interface SearchParams {
  search?: string;
  visibility?: string;
  archived?: string;
  page?: string;
}

export default async function PlansPage(props: { searchParams: Promise<SearchParams> }) {
  const admin = await requirePlatformAdmin();
  const searchParams = await props.searchParams;

  const search       = searchParams.search?.trim() || undefined;
  const visibility   = searchParams.visibility === 'public' ? true
                     : searchParams.visibility === 'private' ? false
                     : undefined;
  const showArchived = searchParams.archived === 'true';
  const page         = Math.max(1, Number(searchParams.page) || 1);

  const hasFilter = Boolean(search || searchParams.visibility || searchParams.archived);

  const res = await getPlansAction({
    search,
    isPublic: visibility,
    isArchived: showArchived,
    page,
    pageSize: 25,
  });

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

        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-2">
            <h2 className="text-3xl font-bold tracking-tight text-text-primary">Plans</h2>
            <p className="max-w-2xl text-text-secondary">
              Gerencie o catálogo de planos da plataforma.
            </p>
          </div>
          {admin.role === 'owner' && (
            <Button asChild>
              <Link href="/admin/plans/new">
                <Plus className="size-4" aria-hidden="true" />
                Novo plano
              </Link>
            </Button>
          )}
        </div>

        <PlansToolbar />

        <div className="overflow-hidden rounded-xl border border-border bg-surface-raised shadow-sm">
          {res.success && res.data ? (
            <PlansList
              items={res.data}
              metadata={res.metadata}
              adminRole={admin.role}
              hasFilter={hasFilter}
            />
          ) : (
            <p className="px-6 py-6 text-sm text-feedback-danger-fg">
              {res.error ?? 'Erro ao carregar planos.'}
            </p>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
