import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Calendar, ChevronRight, Clock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { FunnelForm } from '@/components/funnels/FunnelForm';
import { getFunnelByIdAction } from '@/lib/actions/funnels';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export default async function EditFunnelPage(props: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getSessionContext();
  if (ctx.role === 'user' || ctx.role === 'viewer') {
    redirect('/dashboard?notice=restricted');
  }

  const { id } = await props.params;
  const res = await getFunnelByIdAction(id);
  if (!res.success || !res.data) {
    notFound();
  }

  const funnel = res.data;

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
              href="/funnels"
              className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
            >
              Funis
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-4 text-text-muted" />
          </li>
          <li className="truncate font-semibold text-text-primary" title={funnel.name}>
            {funnel.name}
          </li>
        </ol>
      </nav>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">{funnel.name}</h2>
          <Badge variant={funnel.is_active ? 'role-admin' : 'status-inactive'}>
            {funnel.is_active ? 'Ativo' : 'Inativo'}
          </Badge>
        </div>
        <div className="flex items-center gap-4 text-sm text-text-secondary">
          <span className="flex items-center gap-1.5">
            <Calendar className="size-3.5" aria-hidden="true" />
            Criado em {formatDate(funnel.created_at)}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5" aria-hidden="true" />
            Atualizado em {formatDate(funnel.updated_at)}
          </span>
        </div>
      </div>

      <FunnelForm mode="edit" funnel={funnel} />
    </div>
  );
}
