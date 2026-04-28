import { Mail, ShieldAlert, ShieldCheck, ShieldOff, UserCircle2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { PlatformAdminListRow } from '@/lib/actions/admin/platform-admins.schemas';
import type { PlatformAdminRole } from '@/lib/auth/platformAdmin';

import { AdminDetailActions } from './AdminDetailActions';
import { formatAbsoluteDate, formatRelative, roleBadgeVariant, roleLabel } from './formatters';

interface Props {
  admin:            PlatformAdminListRow;
  currentRole:      PlatformAdminRole;
  currentProfileId: string;
}

export function AdminDetailCard({ admin, currentRole, currentProfileId }: Props) {
  const adminLabel = admin.fullName ?? admin.email ?? 'Sem nome';

  return (
    <div className="flex flex-col gap-6 rounded-xl border border-border bg-surface-raised p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          {admin.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={admin.avatarUrl}
              alt=""
              className="size-16 rounded-full border border-border-subtle object-cover"
            />
          ) : (
            <div className="flex size-16 items-center justify-center rounded-full border border-border-subtle bg-surface-sunken text-text-muted">
              <UserCircle2 className="size-9" aria-hidden="true" />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <h3 className="text-2xl font-bold tracking-tight text-text-primary">
              {adminLabel}
            </h3>
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-sm text-text-secondary">
                <Mail className="size-4" aria-hidden="true" />
                {admin.email ?? '—'}
              </span>
              <Badge variant={roleBadgeVariant(admin.role)}>{roleLabel(admin.role)}</Badge>
              {!admin.isActive && (
                <Badge variant="status-inactive">Desativado</Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-4 border-t border-border-subtle pt-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            MFA
          </dt>
          <dd className="text-sm">
            {admin.mfaResetRequired ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-feedback-warning-fg">
                <ShieldAlert className="size-4" aria-hidden="true" />
                Reset pendente
              </span>
            ) : admin.mfaConfigured ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-feedback-success-fg">
                <ShieldCheck className="size-4" aria-hidden="true" />
                Configurado
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-medium text-text-muted">
                <ShieldOff className="size-4" aria-hidden="true" />
                Não configurado
              </span>
            )}
          </dd>
        </div>

        <div className="flex flex-col gap-1">
          <dt className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Último login
          </dt>
          <dd className="text-sm text-text-primary">
            {admin.lastSignInAt ? formatRelative(admin.lastSignInAt) : 'Nunca'}
          </dd>
        </div>

        <div className="flex flex-col gap-1">
          <dt className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Admin desde
          </dt>
          <dd className="text-sm text-text-primary">{formatAbsoluteDate(admin.createdAt)}</dd>
        </div>

        {admin.deactivatedAt && (
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Desativado em
            </dt>
            <dd className="text-sm text-feedback-danger-fg">
              {formatAbsoluteDate(admin.deactivatedAt)}
            </dd>
          </div>
        )}
      </dl>

      {currentRole === 'owner' && admin.isActive && (
        <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
          <h4 className="text-sm font-semibold text-text-primary">Ações</h4>
          <AdminDetailActions admin={admin} currentProfileId={currentProfileId} />
        </div>
      )}
    </div>
  );
}
