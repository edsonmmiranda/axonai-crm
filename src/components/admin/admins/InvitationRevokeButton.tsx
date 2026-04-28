'use client';

import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
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
import { revokeInvitationAction } from '@/lib/actions/admin/platform-admins';

interface Props {
  invitationId: string;
  email:        string;
}

export function InvitationRevokeButton({ invitationId, email }: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const res = await revokeInvitationAction({ id: invitationId });
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível revogar o convite.');
        return;
      }
      toast.success(`Convite para ${email} revogado.`);
      setOpen(false);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="danger"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        Revogar
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revogar convite?</DialogTitle>
            <DialogDescription>
              O convite enviado para{' '}
              <span className="font-semibold text-text-primary">{email}</span>{' '}
              não poderá mais ser utilizado. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleConfirm}
              disabled={isPending}
            >
              {isPending ? 'Revogando...' : 'Revogar convite'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
