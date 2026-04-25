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
import { Textarea } from '@/components/ui/textarea';
import { suspendOrganizationAction } from '@/lib/actions/admin/organizations';

interface Props {
  orgId: string;
  orgSlug: string;
  orgName: string;
  open: boolean;
  onClose: () => void;
}

export function OrgSuspendDialog({ orgId, orgSlug, orgName, open, onClose }: Props) {
  const [slugConfirmation, setSlugConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [isPending, startTransition] = useTransition();

  const canSubmit = slugConfirmation === orgSlug && reason.trim().length >= 5;

  function handleClose() {
    setSlugConfirmation('');
    setReason('');
    onClose();
  }

  function handleConfirm() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await suspendOrganizationAction({ id: orgId, slugConfirmation, reason: reason.trim() });
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível suspender a organização.');
        return;
      }
      toast.success(`Organização "${orgName}" suspensa.`);
      handleClose();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suspender organização</DialogTitle>
          <DialogDescription>
            Esta ação bloqueará imediatamente o acesso dos usuários de{' '}
            <span className="font-semibold text-text-primary">{orgName}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="slugConfirm" required>
              Digite o slug <code className="rounded bg-surface-sunken px-1 text-xs">{orgSlug}</code> para confirmar
            </Label>
            <Input
              id="slugConfirm"
              value={slugConfirmation}
              onChange={(e) => setSlugConfirmation(e.target.value)}
              placeholder={orgSlug}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="suspendReason" required>
              Motivo da suspensão
            </Label>
            <Textarea
              id="suspendReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Descreva o motivo da suspensão..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" onClick={handleConfirm} disabled={!canSubmit || isPending}>
            {isPending ? 'Suspendendo...' : 'Suspender organização'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
