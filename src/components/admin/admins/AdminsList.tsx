import Link from 'next/link';
import { ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { PlatformAdminListRow } from '@/lib/actions/admin/platform-admins.schemas';
import type { PlatformAdminRole } from '@/lib/auth/platformAdmin';

import { formatAbsoluteDate, formatRelative, roleBadgeVariant, roleLabel } from './formatters';

interface Props {
  admins: PlatformAdminListRow[];
  currentRole: PlatformAdminRole;
}

export function AdminsList({ admins, currentRole }: Props) {
  if (admins.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <p className="text-sm font-medium text-text-primary">Nenhum admin ativo</p>
        <p className="text-sm text-text-secondary">Convide o primeiro administrador para começar.</p>
        {currentRole === 'owner' && (
          <Button asChild className="mt-2">
            <Link href="/admin/admins/invite">Convidar primeiro admin</Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-border-subtle bg-surface-sunken text-xs uppercase text-text-secondary">
          <tr>
            <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Nome</th>
            <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Email</th>
            <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Papel</th>
            <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">MFA</th>
            <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Último login</th>
            <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Criado em</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {admins.map((admin) => (
            <tr key={admin.id} className="group transition-colors hover:bg-surface-sunken/80">
              <td className="whitespace-nowrap px-3 py-4">
                <Link
                  href={`/admin/admins/${admin.id}`}
                  className="rounded font-bold text-text-primary transition-colors hover:text-action-primary focus-visible:outline-none focus-visible:shadow-focus"
                >
                  {admin.fullName ?? admin.email ?? 'Sem nome'}
                </Link>
              </td>
              <td className="whitespace-nowrap px-3 py-4 text-text-secondary">
                {admin.email ?? '—'}
              </td>
              <td className="whitespace-nowrap px-3 py-4">
                <Badge variant={roleBadgeVariant(admin.role)}>{roleLabel(admin.role)}</Badge>
              </td>
              <td className="whitespace-nowrap px-3 py-4">
                {admin.mfaResetRequired ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-feedback-warning-fg">
                    <ShieldAlert className="size-4" aria-hidden="true" />
                    Reset pendente
                  </span>
                ) : admin.mfaConfigured ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-feedback-success-fg">
                    <ShieldCheck className="size-4" aria-hidden="true" />
                    Configurado
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted">
                    <ShieldOff className="size-4" aria-hidden="true" />
                    Pendente
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-4 text-text-secondary">
                {admin.lastSignInAt ? formatRelative(admin.lastSignInAt) : 'Nunca'}
              </td>
              <td className="whitespace-nowrap px-3 py-4 text-text-secondary">
                {formatAbsoluteDate(admin.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
