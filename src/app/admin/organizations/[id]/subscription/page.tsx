import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { notFound } from 'next/navigation';

import { AdminShell } from '@/components/admin/AdminShell';
import { SubscriptionPanel } from '@/components/admin/subscriptions/SubscriptionPanel';
import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';
import { getOrganizationDetailAction } from '@/lib/actions/admin/organizations';
import { getOrgSubscriptionAction } from '@/lib/actions/admin/subscriptions';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Axon Admin — Subscription' };

export default async function OrgSubscriptionPage(props: { params: Promise<{ id: string }> }) {
  const admin = await requirePlatformAdmin();
  const { id } = await props.params;

  const [orgRes, subRes, supabase] = await Promise.all([
    getOrganizationDetailAction(id),
    getOrgSubscriptionAction(id),
    createClient(),
  ]);

  if (!orgRes.success || !orgRes.data) notFound();
  const org = orgRes.data;

  // Buscar planos disponíveis (não arquivados) para os selects
  const { data: plansRaw } = await supabase
    .from('plans')
    .select('id, name')
    .eq('is_archived', false)
    .order('name');

  const availablePlans = (plansRaw ?? []) as Array<{ id: string; name: string }>;

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
            <li>
              <Link href="/admin/organizations" className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus">
                Organizations
              </Link>
            </li>
            <li aria-hidden="true"><ChevronRight className="size-4 text-text-muted" /></li>
            <li>
              <Link href={`/admin/organizations/${id}`} className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus">
                {org.name}
              </Link>
            </li>
            <li aria-hidden="true"><ChevronRight className="size-4 text-text-muted" /></li>
            <li className="font-semibold text-text-primary">Subscription</li>
          </ol>
        </nav>

        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">Subscription — {org.name}</h2>
          <p className="text-text-secondary font-mono text-sm">{org.slug}</p>
        </div>

        <SubscriptionPanel
          orgId={id}
          orgSlug={org.slug}
          subscription={subRes.success ? (subRes.data ?? null) : null}
          availablePlans={availablePlans}
          adminRole={admin.role}
        />
      </div>
    </AdminShell>
  );
}
