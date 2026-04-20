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
import { deleteLeadAction } from '@/lib/actions/leads';

interface DeleteLeadDialogProps {
  leadId: string;
  leadName: string;
  onClose: () => void;
  /** If true, navigate to /leads after deletion (used in edit page) */
  redirectAfter?: boolean;
}

export function DeleteLeadDialog({ leadId, leadName, onClose, redirectAfter }: DeleteLeadDialogProps) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteLeadAction(leadId);
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível excluir o lead.');
        return;
      }
      toast.success(`${leadName} excluído.`);
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
          <DialogTitle>Excluir lead</DialogTitle>
          <DialogDescription>
            Esta ação não pode ser desfeita. O lead{' '}
            <span className="font-semibold text-text-primary">{leadName}</span> será
            excluído permanentemente, incluindo todas as suas tags vinculadas.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5 py-2">
          <Label htmlFor="confirmDeleteLead">
            Digite <span className="font-semibold">excluir</span> para confirmar
          </Label>
          <Input
            id="confirmDeleteLead"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="excluir"
            autoComplete="off"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" onClick={handleDelete} disabled={confirmText !== 'excluir' || isPending}>
            {isPending ? 'Excluindo...' : 'Excluir lead'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
