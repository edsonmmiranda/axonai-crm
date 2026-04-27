import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { notFound } from 'next/navigation';

import { AdminShell } from '@/components/admin/AdminShell';
import { GrantsList } from '@/components/admin/grants/GrantsList';
import {
  GrantsSummaryCards,
  type SummaryItem,
} from '@/components/admin/grants/GrantsSummaryCards';
import { getGrantsAction } from '@/lib/actions/admin/grants';
import type { LimitKey } from '@/lib/actions/admin/grants';
import { getOrganizationDetailAction } from '@/lib/actions/admin/organizations';
import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';

export const metadata = { title: 'Axon Admin — Grants' };

const LIMIT_KEYS: LimitKey[] = [
  'users',
  'leads',
  'products',
  'pipelines',
  'active_integrations',
  'storage_mb',
];

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ includeRevoked?: string; includeExpired?: string }>;
}

export default async function OrgGrantsPage(props: PageProps) {
  const admin = await requirePlatformAdmin();
  const { id } = await props.params;
  const sp = await props.searchParams;

  const includeRevoked = sp.includeRevoked === '1';
  const includeExpired = sp.includeExpired === '1';

  const [orgRes, grantsRes] = await Promise.all([
    getOrganizationDetailAction(id),
    getGrantsAction({ organizationId: id, includeRevoked, includeExpired }),
  ]);

  if (!orgRes.success || !orgRes.data) notFound();
  const org = orgRes.data;

  const grants = grantsRes.success ? (grantsRes.data?.items ?? []) : [];

  const planLimits: Record<LimitKey, number | null> = {
    users:               org.subscription?.maxUsers ?? null,
    leads:               org.subscription?.maxLeads ?? null,
    products:            org.subscription?.maxProducts ?? null,
    pipelines:           org.subscription?.maxPipelines ?? null,
    active_integrations: org.subscription?.maxActiveIntegrations ?? null,
    storage_mb:          org.subscription?.maxStorageMb ?? null,
  };

  const activeGrantByKey: Partial<Record<LimitKey, (typeof grants)[number]>> = {};
  for (const g of grants) {
    if (g.status === 'active' && !activeGrantByKey[g.limitKey]) {
      activeGrantByKey[g.limitKey] = g;
    }
  }

  const summaryItems: SummaryItem[] = LIMIT_KEYS.map((k) => {
    const active = activeGrantByKey[k];
    return {
      limitKey: k,
      planLimit: planLimits[k],
      grantOverride: active?.valueOverride ?? null,
      hasActiveGrant: Boolean(active),
    };
  });

  const canMutate = admin.role === 'owner';

  return (
    <AdminShell admin={admin}>
      <div className="mr-auto flex max-w-page flex-col gap-6 pb-10">
        <nav className="flex text-sm font-medium text-text-secondary" aria-label="breadcrumb">
          <ol className="flex items-center gap-2">
            <li>
              <Link
                href="/admin/dashboard"
                className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
              >
                Dashboard
              </Link>
            </li>
            <li aria-hidden="true"><ChevronRight className="size-4 text-text-muted" /></li>
            <li>
              <Link
                href="/admin/organizations"
                className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
              >
                Organizations
              </Link>
            </li>
            <li aria-hidden="true"><ChevronRight className="size-4 text-text-muted" /></li>
            <li>
              <Link
                href={`/admin/organizations/${id}`}
                className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
              >
                {org.name}
              </Link>
            </li>
            <li aria-hidden="true"><ChevronRight className="size-4 text-text-muted" /></li>
            <li className="font-semibold text-text-primary">Grants</li>
          </ol>
        </nav>

        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">
            Grants — {org.name}
          </h2>
          <p className="text-text-secondary font-mono text-sm">{org.slug}</p>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text-primary">
            Limites efetivos
          </h3>
          <p className="text-xs text-text-secondary">
            Override (grant ativo) substitui o limite do plano vigente.
          </p>
          <GrantsSummaryCards items={summaryItems} />
        </div>

        <GrantsList
          organizationId={id}
          items={grants}
          canMutate={canMutate}
        />
      </div>
    </AdminShell>
  );
}
