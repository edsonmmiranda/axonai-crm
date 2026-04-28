import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { InviteAdminForm } from '@/components/admin/admins/InviteAdminForm';
import { requirePlatformAdminRole } from '@/lib/auth/platformAdmin';

export const metadata = { title: 'Axon Admin — Convidar admin' };

export default async function InviteAdminPage() {
  const admin = await requirePlatformAdminRole(['owner']);

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
            <li className="font-semibold text-text-primary">Convidar</li>
          </ol>
        </nav>

        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">
            Convidar administrador
          </h2>
          <p className="max-w-2xl text-text-secondary">
            O convidado recebe um link por email para criar senha e configurar MFA.
            O link é single-use e expira em 72 horas.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-surface-raised p-6 shadow-sm">
          <InviteAdminForm />
        </div>
      </div>
    </AdminShell>
  );
}
