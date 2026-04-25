'use client';

import { useTransition, useState } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { deletePlanAction } from '@/lib/actions/admin/plans';
import type { PlanListItem } from '@/lib/actions/admin/plans';

interface Props {
  plan: PlanListItem | null;
  onClose: () => void;
}

export function DeletePlanDialog({ plan, onClose }: Props) {
  const router = useRouter();
  const [nameConfirm, setNameConfirm] = useState('');
  const [isPending, startTransition] = useTransition();

  const canSubmit = plan !== null && nameConfirm === plan.name;

  function handleClose() {
    setNameConfirm('');
    onClose();
  }

  function handleConfirm() {
    if (!plan || !canSubmit) return;
    startTransition(async () => {
      const res = await deletePlanAction({ id: plan.id });
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível excluir o plano.');
        return;
      }
      toast.success(`Plano "${plan.name}" excluído.`);
      handleClose();
      router.push('/admin/plans');
    });
  }

  return (
    <Dialog open={plan !== null} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir plano</DialogTitle>
          <DialogDescription>
            Esta ação é irreversível. O plano será removido permanentemente.
          </DialogDescription>
        </DialogHeader>

        {plan && (
          <div className="flex flex-col gap-1.5 py-2">
            <Label htmlFor="nameConfirm">
              Digite <span className="font-semibold text-text-primary">{plan.name}</span> para confirmar
            </Label>
            <Input
              id="nameConfirm"
              value={nameConfirm}
              onChange={(e) => setNameConfirm(e.target.value)}
              placeholder={plan.name}
              autoComplete="off"
            />
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" onClick={handleConfirm} disabled={!canSubmit || isPending}>
            {isPending ? 'Excluindo...' : 'Excluir plano'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
