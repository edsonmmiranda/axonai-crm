import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { notFound } from 'next/navigation';

import { AdminShell } from '@/components/admin/AdminShell';
import { OrgDetailView } from '@/components/admin/organizations/OrgDetailView';
import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';
import { getOrganizationDetailAction } from '@/lib/actions/admin/organizations';

export const metadata = { title: 'Axon Admin — Organização' };

export default async function OrganizationDetailPage(props: { params: Promise<{ id: string }> }) {
  const admin = await requirePlatformAdmin();
  const { id } = await props.params;

  const res = await getOrganizationDetailAction(id);
  if (!res.success || !res.data) notFound();

  const org = res.data;

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
            <li className="font-semibold text-text-primary">{org.name}</li>
          </ol>
        </nav>

        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">{org.name}</h2>
          <p className="text-text-secondary font-mono text-sm">{org.slug}</p>
        </div>

        <OrgDetailView org={org} adminRole={admin.role} />
      </div>
    </AdminShell>
  );
}
