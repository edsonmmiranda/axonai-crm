'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Archive, ArchiveRestore, Pencil } from 'lucide-react';
import { toast } from 'sonner';

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
import {
  archiveProductAction,
  restoreProductAction,
} from '@/lib/actions/products';
import type { ProductStatus } from '@/lib/products/constants';

interface ProductRowActionsProps {
  id: string;
  name: string;
  status: ProductStatus;
}

const ICON_BTN_BASE =
  'inline-flex size-8 items-center justify-center rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-50';

export function ProductRowActions({ id, name, status }: ProductRowActionsProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isActive = status === 'active';

  function onConfirm() {
    startTransition(async () => {
      const res = isActive
        ? await archiveProductAction(id)
        : await restoreProductAction(id);
      if (!res.success) {
        toast.error(res.error ?? 'Operação falhou.');
        return;
      }
      toast.success(isActive ? 'Produto arquivado.' : 'Produto restaurado.');
      setOpen(false);
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Link
        href={`/products/${id}`}
        aria-label={`Editar ${name}`}
        title="Editar"
        className={`${ICON_BTN_BASE} text-text-muted hover:bg-surface-sunken hover:text-text-primary`}
      >
        <Pencil className="size-4" aria-hidden="true" />
      </Link>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={isActive ? `Arquivar ${name}` : `Restaurar ${name}`}
            title={isActive ? 'Arquivar' : 'Restaurar'}
            className={
              isActive
                ? `${ICON_BTN_BASE} text-text-muted hover:bg-feedback-warning-bg hover:text-feedback-warning-fg`
                : `${ICON_BTN_BASE} text-feedback-success-fg hover:bg-feedback-success-bg`
            }
          >
            {isActive ? (
              <Archive className="size-4" aria-hidden="true" />
            ) : (
              <ArchiveRestore className="size-4" aria-hidden="true" />
            )}
          </button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isActive ? 'Arquivar produto?' : 'Restaurar produto?'}
            </DialogTitle>
            <DialogDescription>
              {isActive
                ? `"${name}" ficará oculto da listagem padrão, mas não será excluído. Imagens e documentos permanecem intactos.`
                : `"${name}" voltará a aparecer na listagem padrão.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              variant={isActive ? 'danger' : 'primary'}
              onClick={onConfirm}
              disabled={isPending}
            >
              {isPending ? 'Processando…' : isActive ? 'Arquivar' : 'Restaurar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
