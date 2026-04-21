import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { LeadForm } from '@/components/leads/LeadForm';
import {
  getActiveOriginsAction,
  getActiveProfilesAction,
  getActiveTagsForLeadsAction,
} from '@/lib/actions/leads';
import { getActiveFunnelsWithStagesAction } from '@/lib/actions/funnels';

export default async function NewLeadPage() {
  const [originsRes, profilesRes, tagsRes, funnelsRes] = await Promise.all([
    getActiveOriginsAction(),
    getActiveProfilesAction(),
    getActiveTagsForLeadsAction(),
    getActiveFunnelsWithStagesAction(),
  ]);

  const origins = originsRes.success && originsRes.data ? originsRes.data : [];
  const profiles = profilesRes.success && profilesRes.data ? profilesRes.data : [];
  const tags = tagsRes.success && tagsRes.data ? tagsRes.data : [];
  const funnels = funnelsRes.success && funnelsRes.data ? funnelsRes.data : [];

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
          <li className="font-semibold text-text-primary">Novo lead</li>
        </ol>
      </nav>

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">
            Novo lead
          </h2>
          <p className="text-sm text-text-secondary">
            Preencha os dados para cadastrar um novo lead.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" asChild>
            <Link href="/leads">Cancelar</Link>
          </Button>
          <Button type="submit" form="lead-form">
            Criar lead
          </Button>
        </div>
      </div>

      <LeadForm mode="create" origins={origins} profiles={profiles} tags={tags} funnels={funnels} />
    </div>
  );
}
