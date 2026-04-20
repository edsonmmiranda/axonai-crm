'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Pencil, PowerOff, RefreshCw, Trash2 } from 'lucide-react';
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
import { useState } from 'react';
import {
  deactivateFunnelAction,
  deleteFunnelAction,
  restoreFunnelAction,
} from '@/lib/actions/funnels';

interface FunnelRowActionsProps {
  id: string;
  name: string;
  isActive: boolean;
}

export function FunnelRowActions({ id, name, isActive }: FunnelRowActionsProps) {
  const router = useRouter();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, startDeleteTransition] = useTransition();
  const [isToggling, startToggleTransition] = useTransition();

  function handleToggleActive() {
    startToggleTransition(async () => {
      const res = isActive
        ? await deactivateFunnelAction(id)
        : await restoreFunnelAction(id);
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível alterar o status do funil.');
        return;
      }
      toast.success(isActive ? 'Funil desativado.' : 'Funil reativado.');
      router.refresh();
    });
  }

  function handleDelete() {
    startDeleteTransition(async () => {
      const res = await deleteFunnelAction(id);
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível excluir o funil.');
        setShowDeleteDialog(false);
        return;
      }
      toast.success('Funil excluído.');
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/funnels/${id}`} aria-label={`Editar ${name}`}>
            <Pencil className="size-4" aria-hidden="true" />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleToggleActive}
          disabled={isToggling}
          aria-label={isActive ? `Desativar ${name}` : `Reativar ${name}`}
        >
          {isActive ? (
            <PowerOff className="size-4" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-4" aria-hidden="true" />
          )}
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
              <DialogTitle>Excluir funil</DialogTitle>
              <DialogDescription>
                Esta ação não pode ser desfeita. O funil{' '}
                <span className="font-semibold text-text-primary">{name}</span> e todos os seus
                estágios serão excluídos permanentemente.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5 py-2">
              <Label htmlFor="confirmDeleteFunnel">
                Digite <span className="font-semibold">excluir</span> para confirmar
              </Label>
              <Input
                id="confirmDeleteFunnel"
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
              <button
                type="button"
                onClick={handleDelete}
                disabled={confirmText !== 'excluir' || isDeleting}
                className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-action-danger px-4 text-sm font-bold text-action-danger-fg shadow-sm transition-colors hover:bg-action-danger-hover focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDeleting ? 'Excluindo...' : 'Excluir funil'}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
