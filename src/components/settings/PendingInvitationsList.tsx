'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Copy, RefreshCw, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  resendInvitationAction,
  revokeInvitationAction,
  type PendingInvitation,
} from '@/lib/actions/invitations';

const ROLE_LABEL: Record<PendingInvitation['role'], string> = {
  admin: 'Admin',
  member: 'Membro',
};

function copyToClipboard(text: string): boolean {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
  navigator.clipboard.writeText(text).catch(() => undefined);
  return true;
}

function timeRemaining(expiresAt: string): { label: string; expired: boolean } {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return { label: 'expirado', expired: true };
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days >= 1) return { label: `${days}d`, expired: false };
  const hours = Math.max(1, Math.floor(diff / (1000 * 60 * 60)));
  return { label: `${hours}h`, expired: false };
}

function buildInviteUrl(token: string): string {
  if (typeof window === 'undefined') return `/accept-invite/${token}`;
  return `${window.location.origin}/accept-invite/${token}`;
}

export function PendingInvitationsList({ invitations }: { invitations: PendingInvitation[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (invitations.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-text-secondary">Nenhum convite pendente.</p>
    );
  }

  const handleCopy = (token: string) => {
    const url = buildInviteUrl(token);
    if (copyToClipboard(url)) {
      toast.success('Link copiado.');
    } else {
      toast.info(`Copie manualmente: ${url}`);
    }
  };

  const handleResend = (id: string) => {
    setPendingId(id);
    startTransition(async () => {
      const res = await resendInvitationAction({ invitationId: id });
      setPendingId(null);
      if (!res.success || !res.data) {
        toast.error(res.error ?? 'Falha ao reenviar convite.');
        return;
      }
      if (copyToClipboard(res.data.inviteUrl)) {
        toast.success('Novo link gerado e copiado.');
      } else {
        toast.info(`Novo link: ${res.data.inviteUrl}`);
      }
    });
  };

  const handleRevoke = (id: string) => {
    setPendingId(id);
    startTransition(async () => {
      const res = await revokeInvitationAction({ invitationId: id });
      setPendingId(null);
      if (!res.success) {
        toast.error(res.error ?? 'Falha ao revogar convite.');
        return;
      }
      toast.success('Convite revogado.');
    });
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
            <th scope="col" className="px-4 py-3 font-semibold">
              Email
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Role
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Convidado por
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Expira
            </th>
            <th scope="col" className="px-4 py-3 font-semibold text-right">
              Ações
            </th>
          </tr>
        </thead>
        <tbody>
          {invitations.map((inv) => {
            const remaining = timeRemaining(inv.expires_at);
            const rowPending = isPending && pendingId === inv.id;
            return (
              <tr key={inv.id} className="border-b border-subtle">
                <td className="px-4 py-3 font-medium text-text-primary">{inv.email}</td>
                <td className="px-4 py-3">
                  <Badge variant={inv.role === 'admin' ? 'role-admin' : 'role-member'}>
                    {ROLE_LABEL[inv.role]}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {inv.invited_by_name ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={remaining.expired ? 'status-expired' : 'status-pending'}>
                    {remaining.label}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopy(inv.token)}
                      aria-label="Copiar link do convite"
                    >
                      <Copy className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleResend(inv.id)}
                      disabled={rowPending}
                      aria-label="Reenviar convite"
                    >
                      <RefreshCw className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevoke(inv.id)}
                      disabled={rowPending}
                      aria-label="Revogar convite"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
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
