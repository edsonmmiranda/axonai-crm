import Link from 'next/link';
import { ChevronRight, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { AdminShell } from '@/components/admin/AdminShell';
import { OrganizationsList } from '@/components/admin/organizations/OrganizationsList';
import { OrganizationsToolbar } from '@/components/admin/organizations/OrganizationsToolbar';
import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';
import { getOrganizationsAction } from '@/lib/actions/admin/organizations';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Axon Admin — Organizations' };

interface SearchParams {
  search?: string;
  isActive?: string;
  planId?: string;
  subStatus?: string;
  page?: string;
}

export default async function OrganizationsPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const admin = await requirePlatformAdmin();
  const searchParams = await props.searchParams;

  const search    = searchParams.search?.trim() || undefined;
  const isActive  = searchParams.isActive === 'true' ? true : searchParams.isActive === 'false' ? false : undefined;
  const planId    = searchParams.planId   || undefined;
  const subStatus = (searchParams.subStatus || undefined) as
    | 'trial' | 'ativa' | 'past_due' | 'trial_expired' | 'cancelada' | 'suspensa'
    | undefined;
  const page      = Math.max(1, Number(searchParams.page) || 1);

  const hasFilter = Boolean(search || searchParams.isActive || planId || subStatus);

  // Buscar organizations e planos em paralelo
  const supabase = await createClient();
  const [orgsRes, plansRes] = await Promise.all([
    getOrganizationsAction({ search, isActive, planId, subStatus, page, pageSize: 25 }),
    supabase.from('plans').select('id, name').eq('is_archived', false).order('name'),
  ]);

  const plans = (plansRes.data ?? []) as Array<{ id: string; name: string }>;

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
            <li className="font-semibold text-text-primary">Organizations</li>
          </ol>
        </nav>

        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-2">
            <h2 className="text-3xl font-bold tracking-tight text-text-primary">Organizations</h2>
            <p className="max-w-2xl text-text-secondary">
              Gerencie todas as organizações-clientes da plataforma.
            </p>
          </div>
          {admin.role === 'owner' && (
            <Button asChild>
              <Link href="/admin/organizations/new">
                <Plus className="size-4" aria-hidden="true" />
                Nova organização
              </Link>
            </Button>
          )}
        </div>

        <OrganizationsToolbar plans={plans} />

        <div className="overflow-hidden rounded-xl border border-border bg-surface-raised shadow-sm">
          {orgsRes.success && orgsRes.data ? (
            <OrganizationsList
              items={orgsRes.data}
              metadata={orgsRes.metadata}
              adminRole={admin.role}
              hasFilter={hasFilter}
            />
          ) : (
            <p className="px-6 py-6 text-sm text-feedback-danger-fg">
              {orgsRes.error ?? 'Erro ao carregar organizations.'}
            </p>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
