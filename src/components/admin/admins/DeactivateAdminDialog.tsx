'use client';

import { useState, useTransition } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { deactivatePlatformAdminAction } from '@/lib/actions/admin/platform-admins';

interface Props {
  adminId:    string;
  email:      string;
  adminLabel: string;
  open:       boolean;
  onClose:    () => void;
}

export function DeactivateAdminDialog({ adminId, email, adminLabel, open, onClose }: Props) {
  const [confirmation, setConfirmation] = useState('');
  const [isPending, startTransition]    = useTransition();

  const canSubmit = confirmation.trim().toLowerCase() === email.toLowerCase();

  function handleClose() {
    setConfirmation('');
    onClose();
  }

  function handleConfirm() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await deactivatePlatformAdminAction({
        id:           adminId,
        confirmEmail: confirmation.trim(),
      });
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível desativar o admin.');
        return;
      }
      toast.success(`${adminLabel} desativado.`);
      handleClose();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Desativar administrador</DialogTitle>
          <DialogDescription>
            Esta ação revoga imediatamente o acesso de{' '}
            <span className="font-semibold text-text-primary">{adminLabel}</span> à área admin.
            Reativar exige novo convite. Não é possível desativar o último owner ativo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-email" required>
              Digite o email{' '}
              <code className="rounded bg-surface-sunken px-1 text-xs">{email}</code>{' '}
              para confirmar
            </Label>
            <Input
              id="confirm-email"
              type="email"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={email}
              autoComplete="off"
              disabled={isPending}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={handleConfirm}
            disabled={!canSubmit || isPending}
          >
            {isPending ? 'Desativando...' : 'Desativar administrador'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
