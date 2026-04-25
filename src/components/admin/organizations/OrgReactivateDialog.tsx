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
import { reactivateOrganizationAction } from '@/lib/actions/admin/organizations';

interface Props {
  orgId: string;
  orgSlug: string;
  orgName: string;
  open: boolean;
  onClose: () => void;
}

export function OrgReactivateDialog({ orgId, orgSlug, orgName, open, onClose }: Props) {
  const [slugConfirmation, setSlugConfirmation] = useState('');
  const [isPending, startTransition] = useTransition();

  const canSubmit = slugConfirmation === orgSlug;

  function handleClose() {
    setSlugConfirmation('');
    onClose();
  }

  function handleConfirm() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await reactivateOrganizationAction({ id: orgId, slugConfirmation });
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível reativar a organização.');
        return;
      }
      toast.success(`Organização "${orgName}" reativada.`);
      handleClose();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reativar organização</DialogTitle>
          <DialogDescription>
            Os usuários de{' '}
            <span className="font-semibold text-text-primary">{orgName}</span>{' '}
            recuperarão acesso imediatamente.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="slugConfirmReactivate" required>
              Digite o slug <code className="rounded bg-surface-sunken px-1 text-xs">{orgSlug}</code> para confirmar
            </Label>
            <Input
              id="slugConfirmReactivate"
              value={slugConfirmation}
              onChange={(e) => setSlugConfirmation(e.target.value)}
              placeholder={orgSlug}
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!canSubmit || isPending}>
            {isPending ? 'Reativando...' : 'Reativar organização'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
