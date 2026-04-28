import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import type {
  MfaResetRequestRow,
  PlatformAdminListRow,
} from '@/lib/actions/admin/platform-admins.schemas';

import { formatRelative } from './formatters';
import { MfaResetActionButtons } from './MfaResetActionButtons';

interface Props {
  requests:         MfaResetRequestRow[];
  admins:           PlatformAdminListRow[];
  currentProfileId: string;
  canMutate:        boolean;
}

interface RequestStatus {
  label:   string;
  variant: 'status-pending' | 'status-expired' | 'status-inactive' | 'role-owner';
}

function statusFor(req: MfaResetRequestRow, now: number): RequestStatus {
  if (req.consumedAt) return { label: 'Consumida',  variant: 'status-inactive' };
  if (req.revokedAt)  return { label: 'Revogada',   variant: 'status-inactive' };
  if (new Date(req.expiresAt).getTime() <= now) {
    return { label: 'Expirada', variant: 'status-expired' };
  }
  if (req.approvedAt) return { label: 'Aprovada',  variant: 'role-owner' };
  return { label: 'Pendente',   variant: 'status-pending' };
}

export function MfaResetRequestsList({
  requests,
  admins,
  currentProfileId,
  canMutate,
}: Props) {
  const adminByProfile = new Map(admins.map((a) => [a.profileId, a]));
  const adminById      = new Map(admins.map((a) => [a.id, a]));

  const activeOwnerCount = admins.filter(
    (a) => a.isActive && a.role === 'owner',
  ).length;
  const showDeadlockAlert = activeOwnerCount > 0 && activeOwnerCount <= 2;

  const now = Date.now();

  if (requests.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {showDeadlockAlert && (
          <Alert intent="warning" title="Atenção: poucos owners ativos">
            Para aprovar pedidos de reset MFA é necessário um terceiro owner distinto do solicitante e do alvo.
            Hoje há apenas {activeOwnerCount} owner{activeOwnerCount === 1 ? '' : 's'} ativo{activeOwnerCount === 1 ? '' : 's'} —
            convide outro antes que um pedido bloqueie.
          </Alert>
        )}
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <p className="text-sm font-medium text-text-primary">Nenhum pedido de reset MFA</p>
          <p className="text-sm text-text-secondary">
            Pedidos pendentes, aprovados, consumidos ou expirados aparecem aqui.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {showDeadlockAlert && (
        <Alert intent="warning" title="Atenção: poucos owners ativos">
          Para aprovar pedidos de reset MFA é necessário um terceiro owner distinto do solicitante e do alvo.
          Hoje há apenas {activeOwnerCount} owner{activeOwnerCount === 1 ? '' : 's'} ativo{activeOwnerCount === 1 ? '' : 's'} —
          convide outro antes que um pedido bloqueie.
        </Alert>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border-subtle bg-surface-sunken text-xs uppercase text-text-secondary">
            <tr>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Alvo</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Solicitado por</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Motivo</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Status</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Expira</th>
              <th scope="col" className="py-3.5 pl-3 pr-6 text-right font-semibold tracking-wide">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {requests.map((req) => {
              const target = adminById.get(req.targetPlatformAdminId);
              const targetLabel =
                target?.fullName ?? target?.email ?? req.targetProfileId;
              const requester = adminByProfile.get(req.requestedBy);
              const requesterLabel =
                requester?.fullName ?? requester?.email ?? req.requestedBy;
              const status = statusFor(req, now);
              const isPending =
                !req.approvedAt && !req.consumedAt && !req.revokedAt &&
                new Date(req.expiresAt).getTime() > now;
              const showApprove =
                canMutate &&
                isPending &&
                req.requestedBy   !== currentProfileId &&
                req.targetProfileId !== currentProfileId;
              const showRevoke =
                canMutate &&
                isPending;

              return (
                <tr key={req.id} className="group transition-colors hover:bg-surface-sunken/80">
                  <td className="whitespace-nowrap px-3 py-4 font-medium text-text-primary">
                    {targetLabel}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-text-secondary">
                    {requesterLabel}
                  </td>
                  <td className="px-3 py-4 text-text-secondary max-w-xs truncate" title={req.reason}>
                    {req.reason}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4">
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-text-secondary">
                    {formatRelative(req.expiresAt, now)}
                  </td>
                  <td className="whitespace-nowrap py-4 pl-3 pr-6">
                    <MfaResetActionButtons
                      requestId={req.id}
                      targetLabel={targetLabel}
                      reason={req.reason}
                      showApprove={showApprove}
                      showRevoke={showRevoke}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
