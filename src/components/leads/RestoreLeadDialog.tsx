'use client';

import { useTransition } from 'react';
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
import { restoreLeadAction } from '@/lib/actions/leads';

interface RestoreLeadDialogProps {
  leadId: string;
  leadName: string;
  onClose: () => void;
}

export function RestoreLeadDialog({ leadId, leadName, onClose }: RestoreLeadDialogProps) {
  const [isPending, startTransition] = useTransition();

  function handleRestore() {
    startTransition(async () => {
      const res = await restoreLeadAction(leadId);
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível reativar o lead.');
        return;
      }
      toast.success(`${leadName} reativado.`);
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reativar lead</DialogTitle>
          <DialogDescription>
            O lead{' '}
            <span className="font-semibold text-text-primary">{leadName}</span> será
            reativado e voltará a aparecer nas listagens padrão.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleRestore} disabled={isPending}>
            {isPending ? 'Reativando...' : 'Reativar lead'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
