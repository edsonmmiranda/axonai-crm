'use client';

import Link from 'next/link';
import { useTransition, useState } from 'react';
import { Pencil, Power, Trash2 } from 'lucide-react';
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
import {
  toggleWhatsappGroupActiveAction,
  deleteWhatsappGroupAction,
} from '@/lib/actions/whatsapp-groups';

interface WhatsappGroupRowActionsProps {
  id: string;
  name: string;
  isActive: boolean;
}

export function WhatsappGroupRowActions({ id, name, isActive }: WhatsappGroupRowActionsProps) {
  const [isToggling, startToggleTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  function handleToggle() {
    startToggleTransition(async () => {
      const res = await toggleWhatsappGroupActiveAction(id);
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível alterar o status.');
        return;
      }
      toast.success(isActive ? 'Grupo desativado.' : 'Grupo ativado.');
    });
  }

  function handleDelete() {
    startDeleteTransition(async () => {
      const res = await deleteWhatsappGroupAction(id);
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível excluir o grupo.');
        setShowDeleteDialog(false);
        return;
      }
      toast.success('Grupo excluído.');
      setShowDeleteDialog(false);
    });
  }

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/whatsapp-groups/${id}`} aria-label={`Editar ${name}`}>
            <Pencil className="size-4" aria-hidden="true" />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleToggle}
          disabled={isToggling}
          aria-label={isActive ? `Desativar ${name}` : `Ativar ${name}`}
        >
          <Power className="size-4" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setConfirmText('');
            setShowDeleteDialog(true);
          }}
          aria-label={`Excluir ${name}`}
          className="text-feedback-danger-fg hover:bg-feedback-danger-bg hover:text-feedback-danger-fg"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </div>

      {showDeleteDialog ? (
        <Dialog open onOpenChange={(open) => !open && setShowDeleteDialog(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Excluir grupo</DialogTitle>
              <DialogDescription>
                Esta ação não pode ser desfeita. O grupo{' '}
                <span className="font-semibold text-text-primary">{name}</span> será excluído
                permanentemente.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1.5 py-2">
              <Label htmlFor="confirmDeleteGroup">
                Digite <span className="font-semibold">excluir</span> para confirmar
              </Label>
              <Input
                id="confirmDeleteGroup"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="excluir"
                autoComplete="off"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowDeleteDialog(false)}
                disabled={isDeleting}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={handleDelete}
                disabled={confirmText !== 'excluir' || isDeleting}
              >
                {isDeleting ? 'Excluindo...' : 'Excluir grupo'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
