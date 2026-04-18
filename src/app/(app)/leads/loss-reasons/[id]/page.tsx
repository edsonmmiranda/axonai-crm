import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import { LossReasonForm } from '@/components/loss-reasons/LossReasonForm';
import { getLossReasonByIdAction } from '@/lib/actions/loss-reasons';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

export default async function EditLossReasonPage(props: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getSessionContext();
  if (ctx.role === 'member') {
    redirect('/leads?notice=restricted');
  }

  const { id } = await props.params;
  const res = await getLossReasonByIdAction(id);
  if (!res.success || !res.data) {
    notFound();
  }

  const reason = res.data;

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
              href="/leads/loss-reasons"
              className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
            >
              Motivos de Perda
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-4 text-text-muted" />
          </li>
          <li className="truncate font-semibold text-text-primary" title={reason.name}>
            {reason.name}
          </li>
        </ol>
      </nav>

      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight text-text-primary">
          {reason.name}
        </h2>
        <p className="max-w-2xl text-text-secondary">
          Atualize os dados deste motivo de perda.
        </p>
      </div>

      <LossReasonForm mode="edit" reason={reason} />
    </div>
  );
}
