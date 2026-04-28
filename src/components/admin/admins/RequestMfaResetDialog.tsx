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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { requestMfaResetAction } from '@/lib/actions/admin/platform-admins';

interface Props {
  targetAdminId: string;
  adminLabel:    string;
  open:          boolean;
  onClose:       () => void;
}

export function RequestMfaResetDialog({ targetAdminId, adminLabel, open, onClose }: Props) {
  const [reason, setReason] = useState('');
  const [isPending, startTransition] = useTransition();

  const canSubmit = reason.trim().length >= 5 && reason.trim().length <= 500;

  function handleClose() {
    setReason('');
    onClose();
  }

  function handleConfirm() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await requestMfaResetAction({
        targetAdminId,
        reason: reason.trim(),
      });
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível abrir o pedido de reset.');
        return;
      }
      toast.success(
        `Pedido de reset MFA aberto para ${adminLabel}. Aguardando aprovação de outro owner.`,
      );
      handleClose();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Solicitar reset de MFA</DialogTitle>
          <DialogDescription>
            Este pedido precisa ser aprovado por <strong>outro owner distinto</strong> de você
            e do alvo. Após aprovação, o TOTP atual de{' '}
            <span className="font-semibold text-text-primary">{adminLabel}</span> será
            invalidado e o admin será forçado a reconfigurar MFA. O pedido expira em 24h
            sem aprovação.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mfa-reset-reason" required>
              Motivo (5–500 caracteres)
            </Label>
            <Textarea
              id="mfa-reset-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: aparelho perdido, suspeita de comprometimento, troca de celular..."
              rows={4}
              maxLength={500}
              disabled={isPending}
            />
            <p className="text-xs text-text-secondary">
              {reason.trim().length}/500 caracteres
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!canSubmit || isPending}
          >
            {isPending ? 'Abrindo pedido...' : 'Abrir pedido de reset'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
