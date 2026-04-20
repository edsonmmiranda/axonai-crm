import Link from 'next/link';
import { ChevronRight, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { LeadsList } from '@/components/leads/LeadsList';
import { LeadsToolbar } from '@/components/leads/LeadsToolbar';
import {
  getLeadsAction,
  getActiveOriginsAction,
  getActiveLossReasonsAction,
  getActiveProfilesAction,
  getActiveTagsForLeadsAction,
  type LeadStatus,
} from '@/lib/actions/leads';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

interface SearchParams {
  search?: string;
  status?: string;
  originId?: string;
  assignedTo?: string;
  tagId?: string;
  isActive?: string;
  page?: string;
  sortBy?: string;
  sortOrder?: string;
}

export default async function LeadsPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getSessionContext();
  const searchParams = await props.searchParams;

  const search = searchParams.search?.trim() || undefined;
  const status = (searchParams.status || undefined) as LeadStatus | undefined;
  const originId = searchParams.originId || undefined;
  const assignedTo = searchParams.assignedTo || undefined;
  const tagId = searchParams.tagId || undefined;
  const isActiveParam = searchParams.isActive;
  // '' or undefined = active only (default); 'false' = inactive only; 'all' = no filter
  const isActive: boolean | undefined =
    isActiveParam === 'all' ? undefined : isActiveParam === 'false' ? false : true;
  const page = Math.max(1, Number(searchParams.page) || 1);
  const sortBy = searchParams.sortBy || 'created_at';
  const sortOrder = (searchParams.sortOrder === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc';

  const [leadsRes, originsRes, lossReasonsRes, profilesRes, tagsRes] = await Promise.all([
    getLeadsAction({ search, status, originId, assignedTo, tagId, isActive, page, pageSize: 20, sortBy, sortOrder }),
    getActiveOriginsAction(),
    getActiveLossReasonsAction(),
    getActiveProfilesAction(),
    getActiveTagsForLeadsAction(),
  ]);

  const origins = originsRes.success && originsRes.data ? originsRes.data : [];
  const lossReasons = lossReasonsRes.success && lossReasonsRes.data ? lossReasonsRes.data : [];
  const profiles = profilesRes.success && profilesRes.data ? profilesRes.data : [];
  const tags = tagsRes.success && tagsRes.data ? tagsRes.data : [];

  const hasFilter = Boolean(search || status || originId || assignedTo || tagId || isActiveParam);
  const isAdmin = ctx.role === 'owner' || ctx.role === 'admin';

  return (
    <div className="mr-auto flex max-w-page flex-col gap-6 pb-10">
      <nav className="flex text-sm font-medium text-text-secondary" aria-label="breadcrumb">
        <ol className="flex items-center gap-2">
          <li>
            <Link
              href="/dashboard"
              className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
            >
              Home
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-4 text-text-muted" />
          </li>
          <li className="font-semibold text-text-primary">Leads</li>
        </ol>
      </nav>

      <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">
            Leads
          </h2>
          <p className="max-w-2xl text-text-secondary">
            Gerencie todos os leads da sua organização.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button asChild>
            <Link href="/leads/new">
              <Plus className="size-4" aria-hidden="true" />
              Novo lead
            </Link>
          </Button>
        </div>
      </div>

      <LeadsToolbar origins={origins} profiles={profiles} tags={tags} />

      <div className="overflow-hidden rounded-xl border border-border bg-surface-raised shadow-sm">
        {leadsRes.success && leadsRes.data ? (
          <LeadsList
            leads={leadsRes.data}
            lossReasons={lossReasons}
            profiles={profiles}
            isAdmin={isAdmin}
            hasFilter={hasFilter}
            metadata={leadsRes.metadata}
          />
        ) : (
          <p className="px-6 py-6 text-sm text-feedback-danger-fg">
            {leadsRes.error ?? 'Erro ao carregar leads.'}
          </p>
        )}
      </div>
    </div>
  );
}
