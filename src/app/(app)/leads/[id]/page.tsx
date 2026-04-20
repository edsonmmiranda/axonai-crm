import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Calendar, ChevronRight } from 'lucide-react';

import { LeadStatusBadge } from '@/components/leads/LeadStatusBadge';
import { LeadForm } from '@/components/leads/LeadForm';
import {
  getLeadByIdAction,
  getActiveOriginsAction,
  getActiveProfilesAction,
  getActiveTagsForLeadsAction,
  type LeadStatus,
} from '@/lib/actions/leads';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export default async function EditLeadPage(props: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getSessionContext();
  const { id } = await props.params;

  const [leadRes, originsRes, profilesRes, tagsRes] = await Promise.all([
    getLeadByIdAction(id),
    getActiveOriginsAction(),
    getActiveProfilesAction(),
    getActiveTagsForLeadsAction(),
  ]);

  if (!leadRes.success || !leadRes.data) {
    notFound();
  }

  const lead = leadRes.data;
  const origins = originsRes.success && originsRes.data ? originsRes.data : [];
  const profiles = profilesRes.success && profilesRes.data ? profilesRes.data : [];
  const tags = tagsRes.success && tagsRes.data ? tagsRes.data : [];
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
          <li className="truncate font-semibold text-text-primary" title={lead.name}>
            {lead.name}
          </li>
        </ol>
      </nav>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">
            {lead.name}
          </h2>
          <LeadStatusBadge status={lead.status as LeadStatus} />
        </div>
        <div className="flex items-center gap-4 text-sm text-text-secondary">
          <span className="flex items-center gap-1.5">
            <Calendar className="size-3.5" aria-hidden="true" />
            Criado em {formatDate(lead.created_at)}
          </span>
          {lead.assigned_to_name ? (
            <span>Responsável: {lead.assigned_to_name}</span>
          ) : null}
        </div>
      </div>

      <LeadForm
        mode="edit"
        lead={lead}
        origins={origins}
        profiles={profiles}
        tags={tags}
        isAdmin={isAdmin}
      />
    </div>
  );
}
