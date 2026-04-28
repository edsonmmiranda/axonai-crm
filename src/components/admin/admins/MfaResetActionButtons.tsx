'use client';

import { useState, useTransition } from 'react';
import { Check, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  approveMfaResetAction,
  revokeMfaResetRequestAction,
} from '@/lib/actions/admin/platform-admins';

interface Props {
  requestId:       string;
  targetLabel:     string;
  reason:          string;
  showApprove:     boolean;
  showRevoke:      boolean;
}

export function MfaResetActionButtons({
  requestId,
  targetLabel,
  reason,
  showApprove,
  showRevoke,
}: Props) {
  const [openApprove, setOpenApprove] = useState(false);
  const [openRevoke, setOpenRevoke]   = useState(false);
  const [isPending, startTransition]  = useTransition();

  function handleApprove() {
    startTransition(async () => {
      const res = await approveMfaResetAction({ requestId });
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível aprovar o pedido.');
        return;
      }
      toast.success(`Pedido de reset MFA para ${targetLabel} aprovado.`);
      setOpenApprove(false);
    });
  }

  function handleRevoke() {
    startTransition(async () => {
      const res = await revokeMfaResetRequestAction({ requestId });
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível revogar o pedido.');
        return;
      }
      toast.success('Pedido de reset MFA revogado.');
      setOpenRevoke(false);
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {showApprove && (
        <>
          <Button type="button" size="sm" onClick={() => setOpenApprove(true)}>
            <Check className="size-3.5" aria-hidden="true" />
            Aprovar
          </Button>
          <Dialog open={openApprove} onOpenChange={setOpenApprove}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Aprovar reset de MFA?</DialogTitle>
                <DialogDescription>
                  Ao aprovar, o admin{' '}
                  <span className="font-semibold text-text-primary">{targetLabel}</span>{' '}
                  terá o TOTP atual invalidado e será forçado a reconfigurar MFA no
                  próximo acesso. Esta ação é registrada no audit log.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Motivo informado
                </p>
                <p className="mt-1 text-text-primary">{reason}</p>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpenApprove(false)}
                  disabled={isPending}
                >
                  Cancelar
                </Button>
                <Button type="button" onClick={handleApprove} disabled={isPending}>
                  {isPending ? 'Aprovando...' : 'Aprovar reset'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      {showRevoke && (
        <>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={() => setOpenRevoke(true)}
          >
            <XCircle className="size-3.5" aria-hidden="true" />
            Revogar
          </Button>
          <Dialog open={openRevoke} onOpenChange={setOpenRevoke}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Revogar pedido de reset MFA?</DialogTitle>
                <DialogDescription>
                  O pedido será cancelado e não poderá mais ser aprovado. O admin{' '}
                  <span className="font-semibold text-text-primary">{targetLabel}</span>{' '}
                  permanece com o TOTP atual válido.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpenRevoke(false)}
                  disabled={isPending}
                >
                  Voltar
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={handleRevoke}
                  disabled={isPending}
                >
                  {isPending ? 'Revogando...' : 'Revogar pedido'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
