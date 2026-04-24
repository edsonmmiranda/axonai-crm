import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { WhatsappGroupsList } from '@/components/whatsapp-groups/WhatsappGroupsList';
import { WhatsappGroupsSortPanel } from '@/components/whatsapp-groups/WhatsappGroupsSortPanel';
import { WhatsappGroupsToolbar } from '@/components/whatsapp-groups/WhatsappGroupsToolbar';
import { parseSortParam } from '@/components/whatsapp-groups/sort-utils';
import { getWhatsappGroupsAction } from '@/lib/actions/whatsapp-groups';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

interface SearchParams {
  search?: string;
  showInactive?: string;
  page?: string;
  sort?: string;
}

export default async function WhatsappGroupsPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getSessionContext();
  if (ctx.role === 'user' || ctx.role === 'viewer') {
    redirect('/dashboard?notice=restricted');
  }

  const searchParams = await props.searchParams;
  const search = searchParams.search?.trim() || undefined;
  const showInactive = searchParams.showInactive === '1';
  const page = Math.max(1, Number(searchParams.page) || 1);
  const sort = parseSortParam(searchParams.sort);

  const res = await getWhatsappGroupsAction({
    search,
    isActive: showInactive ? undefined : true,
    page,
    pageSize: 20,
    sort,
  });

  const hasFilter = Boolean(search) || showInactive;

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
          <li className="font-semibold text-text-primary">Grupos de WhatsApp</li>
        </ol>
      </nav>

      <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">
            Grupos de WhatsApp
          </h2>
          <p className="max-w-2xl text-text-secondary">
            Gerencie os grupos de WhatsApp da sua organização.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button asChild>
            <Link href="/whatsapp-groups/new">
              <Plus className="size-4" aria-hidden="true" />
              Novo grupo
            </Link>
          </Button>
        </div>
      </div>

      <WhatsappGroupsToolbar />

      <WhatsappGroupsSortPanel />

      <div className="overflow-hidden rounded-xl border border-border bg-surface-raised shadow-sm">
        {res.success && res.data ? (
          <WhatsappGroupsList
            groups={res.data}
            hasFilter={hasFilter}
            metadata={res.metadata}
          />
        ) : (
          <p className="px-6 py-6 text-sm text-feedback-danger-fg">
            {res.error ?? 'Erro ao carregar grupos.'}
          </p>
        )}
      </div>
    </div>
  );
}
