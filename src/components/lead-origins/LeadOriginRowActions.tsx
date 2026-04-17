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
import { deleteLeadOriginAction, restoreLeadOriginAction } from '@/lib/actions/lead-origins';

interface LeadOriginRowActionsProps {
  id: string;
  name: string;
  isActive: boolean;
}

export function LeadOriginRowActions({ id, name, isActive }: LeadOriginRowActionsProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const res = isActive
        ? await deleteLeadOriginAction(id)
        : await restoreLeadOriginAction(id);
      if (!res.success) {
        toast.error(res.error ?? 'Operação falhou.');
        return;
      }
      toast.success(isActive ? 'Origem desativada.' : 'Origem restaurada.');
      setOpen(false);
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/leads/origins/${id}`} aria-label={`Editar ${name}`}>
          <Pencil className="size-4" aria-hidden="true" />
        </Link>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm">
            {isActive ? 'Desativar' : 'Restaurar'}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isActive ? 'Desativar origem?' : 'Restaurar origem?'}
            </DialogTitle>
            <DialogDescription>
              {isActive
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
              variant={isActive ? 'danger' : 'primary'}
              onClick={onConfirm}
              disabled={isPending}
            >
              {isPending ? 'Processando...' : isActive ? 'Desativar' : 'Restaurar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
