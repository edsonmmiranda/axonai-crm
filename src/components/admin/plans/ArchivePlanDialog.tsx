'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}

export function ArchivePlanDialog({ open, onClose, onConfirm, isPending }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Arquivar plano</DialogTitle>
          <DialogDescription>
            O plano será ocultado do catálogo público. Organizações com este plano ativo não são afetadas.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Arquivando...' : 'Arquivar plano'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
