import { Badge } from '@/components/ui/badge';
import type { InvitationRow } from '@/lib/actions/admin/platform-admins.schemas';

import { formatAbsoluteDate, formatRelative, roleBadgeVariant, roleLabel } from './formatters';
import { InvitationCopyButton } from './InvitationCopyButton';
import { InvitationRevokeButton } from './InvitationRevokeButton';

interface Props {
  invitations: InvitationRow[];
  appUrl:      string;
  canMutate:   boolean;
}

export function InvitationsList({ invitations, appUrl, canMutate }: Props) {
  if (invitations.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <p className="text-sm font-medium text-text-primary">Sem convites pendentes</p>
        <p className="text-sm text-text-secondary">
          Convites já consumidos, expirados ou revogados não aparecem aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-border-subtle bg-surface-sunken text-xs uppercase text-text-secondary">
          <tr>
            <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Email</th>
            <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Papel</th>
            <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Criado em</th>
            <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Expira</th>
            <th scope="col" className="py-3.5 pl-3 pr-6 text-right font-semibold tracking-wide">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {invitations.map((inv) => {
            const acceptUrl = `${appUrl}/admin/accept-invite/${inv.token}`;
            return (
              <tr key={inv.id} className="group transition-colors hover:bg-surface-sunken/80">
                <td className="whitespace-nowrap px-3 py-4 font-medium text-text-primary">
                  {inv.email}
                </td>
                <td className="whitespace-nowrap px-3 py-4">
                  <Badge variant={roleBadgeVariant(inv.role)}>{roleLabel(inv.role)}</Badge>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-text-secondary">
                  {formatAbsoluteDate(inv.createdAt)}
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-text-secondary">
                  {formatRelative(inv.expiresAt)}
                </td>
                <td className="whitespace-nowrap py-4 pl-3 pr-6">
                  <div className="flex items-center justify-end gap-2">
                    <InvitationCopyButton link={acceptUrl} />
                    {canMutate && (
                      <InvitationRevokeButton invitationId={inv.id} email={inv.email} />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
