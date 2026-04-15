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
import { deleteCategoryAction, restoreCategoryAction } from '@/lib/actions/categories';

interface CategoryRowActionsProps {
  id: string;
  name: string;
  active: boolean;
}

export function CategoryRowActions({ id, name, active }: CategoryRowActionsProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const res = active
        ? await deleteCategoryAction(id)
        : await restoreCategoryAction(id);
      if (!res.success) {
        toast.error(res.error ?? 'Operação falhou.');
        return;
      }
      toast.success(active ? 'Categoria desativada.' : 'Categoria restaurada.');
      setOpen(false);
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/settings/catalog/categories/${id}`} aria-label={`Editar ${name}`}>
          <Pencil className="size-4" aria-hidden="true" />
        </Link>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm">
            {active ? 'Desativar' : 'Restaurar'}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {active ? 'Desativar categoria?' : 'Restaurar categoria?'}
            </DialogTitle>
            <DialogDescription>
              {active
                ? `"${name}" ficará oculta na listagem padrão, mas não será excluída. Você pode restaurar depois.`
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
              variant={active ? 'danger' : 'primary'}
              onClick={onConfirm}
              disabled={isPending}
            >
              {isPending ? 'Processando…' : active ? 'Desativar' : 'Restaurar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
