'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Pencil } from 'lucide-react';
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
  type ProductStatus,
} from '@/lib/actions/products';

interface ProductRowActionsProps {
  id: string;
  name: string;
  status: ProductStatus;
}

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
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/products/${id}`} aria-label={`Editar ${name}`}>
          <Pencil className="size-4" aria-hidden="true" />
        </Link>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm">
            {isActive ? 'Arquivar' : 'Restaurar'}
          </Button>
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
