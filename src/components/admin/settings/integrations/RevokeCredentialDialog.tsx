'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { revokeIntegrationCredentialAction } from '@/lib/actions/admin/integration-credentials';
import type { IntegrationCredentialView } from '@/lib/actions/admin/integration-credentials.schemas';

interface Props {
  credential: IntegrationCredentialView;
}

export function RevokeCredentialDialog({ credential }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isPending, startTransition] = useTransition();

  const canSubmit = confirmText === credential.kind;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setConfirmText('');
  }

  function handleConfirm() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await revokeIntegrationCredentialAction({
        id:          credential.id,
        confirmKind: credential.kind,
      });
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível revogar a credencial.');
        return;
      }
      toast.success('Credencial revogada.');
      handleOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="danger">
          Revogar credencial
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revogar credencial SMTP</DialogTitle>
          <DialogDescription>
            Esta ação remove a credencial ativa do banco e do Vault. Envios futuros caem para env vars
            ou para fallback offline até que uma nova credencial seja cadastrada.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="revoke-confirm" required>
              Digite <code className="rounded bg-surface-sunken px-1 text-xs">{credential.kind}</code> para confirmar
            </Label>
            <Input
              id="revoke-confirm"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={credential.kind}
              autoComplete="off"
              autoFocus
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={handleConfirm}
            disabled={!canSubmit || isPending}
          >
            {isPending ? 'Revogando…' : 'Revogar credencial'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
