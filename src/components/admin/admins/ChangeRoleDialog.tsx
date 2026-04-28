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
import { changePlatformAdminRoleAction } from '@/lib/actions/admin/platform-admins';
import type { PlatformAdminListRow } from '@/lib/actions/admin/platform-admins.schemas';

import { roleLabel } from './formatters';

const selectClasses =
  'h-10 w-full rounded-md border border-field-border bg-field px-3 text-sm text-field-fg transition-all hover:border-field-border-hover focus-visible:outline-none focus-visible:border-field-border-focus focus-visible:shadow-focus';

type Role = PlatformAdminListRow['role'];

interface Props {
  adminId:     string;
  currentRole: Role;
  adminLabel:  string;
  open:        boolean;
  onClose:     () => void;
}

export function ChangeRoleDialog({ adminId, currentRole, adminLabel, open, onClose }: Props) {
  const [newRole, setNewRole] = useState<Role>(currentRole);
  const [isPending, startTransition] = useTransition();

  function handleClose() {
    setNewRole(currentRole);
    onClose();
  }

  function handleConfirm() {
    if (newRole === currentRole) {
      handleClose();
      return;
    }
    startTransition(async () => {
      const res = await changePlatformAdminRoleAction({ id: adminId, newRole });
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível alterar o papel.');
        return;
      }
      toast.success(`Papel de ${adminLabel} alterado para ${roleLabel(newRole)}.`);
      handleClose();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alterar papel</DialogTitle>
          <DialogDescription>
            Selecione o novo papel para{' '}
            <span className="font-semibold text-text-primary">{adminLabel}</span>.
            Não é possível rebaixar o último owner ativo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-select" required>Novo papel</Label>
            <select
              id="role-select"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as Role)}
              className={selectClasses}
              disabled={isPending}
            >
              <option value="owner">Owner — acesso total à plataforma</option>
              <option value="support">Suporte — leitura + operacional</option>
              <option value="billing">Faturamento — assinaturas e cobranças</option>
            </select>
            <p className="text-xs text-text-secondary">
              Atual: <span className="font-medium">{roleLabel(currentRole)}</span>
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isPending || newRole === currentRole}
          >
            {isPending ? 'Salvando...' : 'Confirmar alteração'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
