import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Calendar, ChevronRight, Clock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { LeadOriginForm } from '@/components/lead-origins/LeadOriginForm';
import { getLeadOriginByIdAction } from '@/lib/actions/lead-origins';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export default async function EditLeadOriginPage(props: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getSessionContext();
  if (ctx.role === 'member') {
    redirect('/leads?notice=restricted');
  }

  const { id } = await props.params;
  const res = await getLeadOriginByIdAction(id);
  if (!res.success || !res.data) {
    notFound();
  }

  const origin = res.data;

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
          <li>
            <Link
              href="/leads"
              className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
            >
              Leads
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-4 text-text-muted" />
          </li>
          <li>
            <Link
              href="/leads/origins"
              className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
            >
              Origens
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-4 text-text-muted" />
          </li>
          <li className="truncate font-semibold text-text-primary" title={origin.name}>
            {origin.name}
          </li>
        </ol>
      </nav>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">
            {origin.name}
          </h2>
          <Badge variant={origin.is_active ? 'role-admin' : 'status-inactive'}>
            {origin.is_active ? 'Ativa' : 'Inativa'}
          </Badge>
        </div>
        <div className="flex items-center gap-4 text-sm text-text-secondary">
          <span className="flex items-center gap-1.5">
            <Calendar className="size-3.5" aria-hidden="true" />
            Criado em {formatDate(origin.created_at)}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5" aria-hidden="true" />
            Atualizado em {formatDate(origin.updated_at)}
          </span>
        </div>
      </div>

      <LeadOriginForm mode="edit" origin={origin} isAdmin />
    </div>
  );
}
