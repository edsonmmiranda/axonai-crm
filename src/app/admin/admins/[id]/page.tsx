import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { AdminDetailCard } from '@/components/admin/admins/AdminDetailCard';
import { listPlatformAdminsAction } from '@/lib/actions/admin/platform-admins';
import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';

export const metadata = { title: 'Axon Admin — Detalhe do administrador' };

interface RouteParams {
  id: string;
}

export default async function AdminDetailPage(props: {
  params: Promise<RouteParams>;
}) {
  const admin   = await requirePlatformAdmin();
  const params  = await props.params;

  const res = await listPlatformAdminsAction();
  if (!res.success || !res.data) {
    notFound();
  }

  const target = res.data.find((a) => a.id === params.id);
  if (!target) {
    notFound();
  }

  const adminLabel = target.fullName ?? target.email ?? 'Sem nome';

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
                href="/admin/admins"
                className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
              >
                Administradores
              </Link>
            </li>
            <li aria-hidden="true"><ChevronRight className="size-4 text-text-muted" /></li>
            <li className="font-semibold text-text-primary">{adminLabel}</li>
          </ol>
        </nav>

        <AdminDetailCard
          admin={target}
          currentRole={admin.role}
          currentProfileId={admin.profileId}
        />
      </div>
    </AdminShell>
  );
}
