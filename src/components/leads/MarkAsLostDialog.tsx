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
import { markLeadAsLostAction, type LossReasonOption } from '@/lib/actions/leads';

interface MarkAsLostDialogProps {
  leadId: string;
  leadName: string;
  lossReasons: LossReasonOption[];
  onClose: () => void;
}

const selectClasses =
  'block w-full rounded-lg border border-field-border bg-field py-2 pl-3 pr-8 text-sm text-field-fg transition-all hover:border-field-border-hover focus-visible:border-field-border-focus focus-visible:outline-none focus-visible:shadow-focus';

export function MarkAsLostDialog({ leadId, leadName, lossReasons, onClose }: MarkAsLostDialogProps) {
  const [lossReasonId, setLossReasonId] = useState('');
  const [lossNotes, setLossNotes] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    if (!lossReasonId) return;
    startTransition(async () => {
      const res = await markLeadAsLostAction(leadId, {
        lossReasonId,
        lossNotes: lossNotes.trim() || '',
      });
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível marcar o lead como perdido.');
        return;
      }
      toast.success(`${leadName} marcado como perdido.`);
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar como perdido</DialogTitle>
          <DialogDescription>
            Informe o motivo da perda do lead{' '}
            <span className="font-semibold text-text-primary">{leadName}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lossReason" required>
              Motivo de perda
            </Label>
            <select
              id="lossReason"
              value={lossReasonId}
              onChange={(e) => setLossReasonId(e.target.value)}
              className={selectClasses}
            >
              <option value="">Selecione um motivo...</option>
              {lossReasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lossNotes">Observações (opcional)</Label>
            <Textarea
              id="lossNotes"
              value={lossNotes}
              onChange={(e) => setLossNotes(e.target.value)}
              placeholder="Detalhes adicionais sobre a perda..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" onClick={handleConfirm} disabled={!lossReasonId || isPending}>
            {isPending ? 'Salvando...' : 'Confirmar perda'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
