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
import { assignLeadAction, type ProfileOption } from '@/lib/actions/leads';

interface AssignLeadDialogProps {
  leadId: string;
  leadName: string;
  profiles: ProfileOption[];
  currentAssignedTo: string | null;
  onClose: () => void;
}

const selectClasses =
  'block w-full rounded-lg border border-field-border bg-field py-2 pl-3 pr-8 text-sm text-field-fg transition-all hover:border-field-border-hover focus-visible:border-field-border-focus focus-visible:outline-none focus-visible:shadow-focus';

export function AssignLeadDialog({ leadId, leadName, profiles, currentAssignedTo, onClose }: AssignLeadDialogProps) {
  const [assignedTo, setAssignedTo] = useState(currentAssignedTo ?? '');
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    if (!assignedTo) return;
    startTransition(async () => {
      const res = await assignLeadAction(leadId, { assignedTo });
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível atribuir o lead.');
        return;
      }
      toast.success(`${leadName} atribuído com sucesso.`);
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Atribuir responsável</DialogTitle>
          <DialogDescription>
            Selecione o responsável pelo lead{' '}
            <span className="font-semibold text-text-primary">{leadName}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="assignTo" required>
              Responsável
            </Label>
            <select
              id="assignTo"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className={selectClasses}
            >
              <option value="">Selecione um responsável...</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!assignedTo || isPending}>
            {isPending ? 'Salvando...' : 'Confirmar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
