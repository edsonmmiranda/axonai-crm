import Link from 'next/link';
import { ChevronRight, Plus } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { AdminsList } from '@/components/admin/admins/AdminsList';
import { AdminsTabs } from '@/components/admin/admins/AdminsTabs';
import { InvitationsList } from '@/components/admin/admins/InvitationsList';
import { MfaResetRequestsList } from '@/components/admin/admins/MfaResetRequestsList';
import { Button } from '@/components/ui/button';
import {
  listInvitationsAction,
  listMfaResetRequestsAction,
  listPlatformAdminsAction,
} from '@/lib/actions/admin/platform-admins';
import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';

export const metadata = { title: 'Axon Admin — Administradores' };

const VALID_TABS = ['admins', 'invitations', 'requests'] as const;
type ValidTab = (typeof VALID_TABS)[number];

interface SearchParams {
  tab?: string;
}

export default async function AdminsPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const admin = await requirePlatformAdmin();
  const sp    = await props.searchParams;

  const requested = (sp.tab ?? 'admins') as string;
  const defaultTab: ValidTab = (VALID_TABS as readonly string[]).includes(requested)
    ? (requested as ValidTab)
    : 'admins';

  const [adminsRes, invitationsRes, requestsRes] = await Promise.all([
    listPlatformAdminsAction(),
    listInvitationsAction('pending'),
    listMfaResetRequestsAction('pending'),
  ]);

  const admins      = adminsRes.success      ? adminsRes.data      ?? [] : [];
  const invitations = invitationsRes.success ? invitationsRes.data ?? [] : [];
  const requests    = requestsRes.success    ? requestsRes.data    ?? [] : [];

  const activeAdmins = admins.filter((a) => a.isActive);
  const appUrl       = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const canMutate    = admin.role === 'owner';

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
            <li className="font-semibold text-text-primary">Administradores</li>
          </ol>
        </nav>

        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-2">
            <h2 className="text-3xl font-bold tracking-tight text-text-primary">
              Administradores
            </h2>
            <p className="max-w-2xl text-text-secondary">
              Gerencie quem tem acesso à área administrativa da plataforma — convites,
              papéis, desativações e pedidos de reset MFA.
            </p>
          </div>
          {canMutate && (
            <Button asChild>
              <Link href="/admin/admins/invite">
                <Plus className="size-4" aria-hidden="true" />
                Convidar admin
              </Link>
            </Button>
          )}
        </div>

        {!adminsRes.success && (
          <p className="rounded-lg border border-feedback-danger-border bg-feedback-danger-bg px-4 py-3 text-sm text-feedback-danger-fg">
            {adminsRes.error ?? 'Erro ao carregar administradores.'}
          </p>
        )}

        <AdminsTabs
          defaultTab={defaultTab}
          pendingInvitations={invitations.length}
          pendingRequests={requests.length}
          adminsSlot={
            <AdminsList admins={activeAdmins} currentRole={admin.role} />
          }
          invitationsSlot={
            <InvitationsList
              invitations={invitations}
              appUrl={appUrl}
              canMutate={canMutate}
            />
          }
          requestsSlot={
            <MfaResetRequestsList
              requests={requests}
              admins={admins}
              currentProfileId={admin.profileId}
              canMutate={canMutate}
            />
          }
        />
      </div>
    </AdminShell>
  );
}
