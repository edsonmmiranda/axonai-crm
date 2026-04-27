'use client';

import { useEffect, useState, useTransition } from 'react';
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
import { revokeGrantAction } from '@/lib/actions/admin/grants';
import type { GrantListItem } from '@/lib/actions/admin/grants';

interface Props {
  grant: GrantListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GrantRevokeDialog({ grant, open, onOpenChange }: Props) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState('');
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) setConfirmation('');
  }, [open]);

  if (!grant) return null;

  const canSubmit = confirmation === grant.limitKey && !isPending;

  function handleConfirm() {
    if (!canSubmit || !grant) return;
    startTransition(async () => {
      const r = await revokeGrantAction({
        grantId: grant.id,
        limitKeyConfirmation: grant.limitKey,
      });
      if (!r.success) {
        toast.error(r.error ?? 'Não foi possível revogar o grant.');
        return;
      }
      toast.success('Grant revogado.');
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revogar grant</DialogTitle>
          <DialogDescription>
            Após revogar, o limite do plano vigente volta a valer imediatamente para esta organização.
            Operações em andamento podem falhar se o consumo atual estiver acima do limite do plano.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3 text-sm text-text-secondary">
            <p>Razão do grant:</p>
            <p className="mt-1 font-medium text-text-primary">{grant.reason}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="limitKeyConfirm" required>
              Digite <code className="rounded bg-surface-sunken px-1 text-xs">{grant.limitKey}</code> para confirmar
            </Label>
            <Input
              id="limitKeyConfirm"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={grant.limitKey}
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" onClick={handleConfirm} disabled={!canSubmit}>
            {isPending ? 'Revogando...' : 'Revogar grant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
