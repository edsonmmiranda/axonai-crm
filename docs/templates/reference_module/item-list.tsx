'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { Item } from '@/lib/validators/item';
import type { PaginationMeta } from '@/types/action-response';
import { Button } from '@/components/ui/button';
import { DeleteConfirmationDialog } from '@/components/ui/delete-confirmation-dialog';
import { useToast } from '@/components/ui/toast';
import { deleteItemAction } from '@/lib/actions/item';

interface ItemListProps {
  items: Item[];
  pagination: PaginationMeta;
}

export function ItemList({ items, pagination }: ItemListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function goToPage(next: number) {
    const params = new URLSearchParams(searchParams);
    params.set('page', String(next));
    router.push(`/items?${params.toString()}`);
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteItemAction(id);
      if (result.success) {
        showToast({ variant: 'success', description: 'Item excluído' });
        setPendingDeleteId(null);
        router.refresh();
      } else {
        showToast({ variant: 'error', description: result.error ?? 'Erro ao excluir' });
      }
    });
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-default bg-surface-raised p-8 text-center">
        <p className="text-text-secondary">Nenhum item encontrado.</p>
        <Button asChild className="mt-4">
          <Link href="/items/new">Criar primeiro item</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-default rounded-lg border border-default bg-surface-raised">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="truncate font-medium text-text-primary">{item.name}</p>
              {item.description && (
                <p className="truncate text-sm text-text-secondary">{item.description}</p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button asChild variant="ghost" size="sm">
                <Link href={`/items/${item.id}/edit`}>Editar</Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPendingDeleteId(item.id)}
              >
                Excluir
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">
          Página {pagination.currentPage} de {pagination.totalPages} — {pagination.total} registro(s)
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pagination.currentPage <= 1}
            onClick={() => goToPage(pagination.currentPage - 1)}
          >
            Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pagination.currentPage >= pagination.totalPages}
            onClick={() => goToPage(pagination.currentPage + 1)}
          >
            Próxima
          </Button>
        </div>
      </div>

      <DeleteConfirmationDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => !open && setPendingDeleteId(null)}
        confirmWord="excluir"
        title="Excluir item"
        description="Esta ação não pode ser desfeita."
        isPending={isPending}
        onConfirm={() => pendingDeleteId && handleDelete(pendingDeleteId)}
      />
    </div>
  );
}
