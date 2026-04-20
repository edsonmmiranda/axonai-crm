'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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
import { deactivateLeadAction } from '@/lib/actions/leads';

interface DeactivateLeadDialogProps {
  leadId: string;
  leadName: string;
  onClose: () => void;
  /** If true, navigate to /leads after deactivation (used in edit page) */
  redirectAfter?: boolean;
}

export function DeactivateLeadDialog({ leadId, leadName, onClose, redirectAfter }: DeactivateLeadDialogProps) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleDeactivate() {
    startTransition(async () => {
      const res = await deactivateLeadAction(leadId);
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível inativar o lead.');
        return;
      }
      toast.success(`${leadName} inativado.`);
      onClose();
      if (redirectAfter) {
        router.push('/leads');
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Inativar lead</DialogTitle>
          <DialogDescription>
            O lead{' '}
            <span className="font-semibold text-text-primary">{leadName}</span> será
            inativado e não aparecerá mais nas listagens padrão. Você poderá reativá-lo
            a qualquer momento.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5 py-2">
          <Label htmlFor="confirmDeactivateLead">
            Digite <span className="font-semibold">inativar</span> para confirmar
          </Label>
          <Input
            id="confirmDeactivateLead"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="inativar"
            autoComplete="off"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" onClick={handleDeactivate} disabled={confirmText !== 'inativar' || isPending}>
            {isPending ? 'Inativando...' : 'Inativar lead'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
