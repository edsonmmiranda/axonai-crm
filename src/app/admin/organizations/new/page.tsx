import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { notFound } from 'next/navigation';

import { AdminShell } from '@/components/admin/AdminShell';
import { OrganizationCreateForm } from '@/components/admin/organizations/OrganizationCreateForm';
import { requirePlatformAdminRole } from '@/lib/auth/platformAdmin';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Axon Admin — Nova organização' };

export default async function NewOrganizationPage() {
  const admin = await requirePlatformAdminRole(['owner']).catch(() => null);
  if (!admin) notFound();

  const supabase = await createClient();
  const { data: plansRaw } = await supabase
    .from('plans')
    .select('id, name')
    .eq('is_archived', false)
    .order('name');

  const plans = (plansRaw ?? []) as Array<{ id: string; name: string }>;

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
            <li className="font-semibold text-text-primary">Nova</li>
          </ol>
        </nav>

        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">Nova organização</h2>
          <p className="text-text-secondary">Onboarding admin-gated: crie a org e gere o convite do primeiro admin.</p>
        </div>

        <div className="rounded-xl border border-border bg-surface-raised p-6 shadow-sm">
          <OrganizationCreateForm plans={plans} />
        </div>
      </div>
    </AdminShell>
  );
}
