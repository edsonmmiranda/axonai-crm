'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import {
  createItemAction,
  updateItemAction,
  deleteItemAction,
} from '@/lib/actions/item';
import { ItemInputSchema, type Item } from '@/lib/validators/item';
import { DeleteConfirmationDialog } from '@/components/ui/delete-confirmation-dialog';

type Mode = 'create' | 'edit';

interface ItemFormProps {
  mode: Mode;
  item?: Item;
}

type FieldErrors = Partial<Record<'name' | 'description', string>>;

export function ItemForm({ mode, item }: ItemFormProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isPending, startTransition] = useTransition();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  function updateField<K extends keyof FieldErrors>(field: K, setter: (v: string) => void, value: string) {
    setter(value);
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  }

  function validate(): boolean {
    const parsed = ItemInputSchema.safeParse({
      name,
      description: description || undefined,
    });
    if (parsed.success) {
      setErrors({});
      return true;
    }
    const next: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof FieldErrors;
      if (key && !next[key]) next[key] = issue.message;
    }
    setErrors(next);
    return false;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    startTransition(async () => {
      const input = { name, description: description || undefined };
      const result = mode === 'create'
        ? await createItemAction(input)
        : await updateItemAction(item!.id, input);

      if (result.success) {
        showToast({
          variant: 'success',
          description: mode === 'create' ? 'Item criado' : 'Item atualizado',
        });
        router.push('/items');
      } else {
        showToast({ variant: 'error', description: result.error ?? 'Erro ao salvar' });
      }
    });
  }

  function handleDelete() {
    if (!item) return;
    startTransition(async () => {
      const result = await deleteItemAction(item.id);
      if (result.success) {
        showToast({ variant: 'success', description: 'Item excluído' });
        router.push('/items');
      } else {
        showToast({ variant: 'error', description: result.error ?? 'Erro ao excluir' });
      }
    });
  }

  return (
    <div className="space-y-8">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="name">Nome</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => updateField('name', setName, e.target.value)}
            aria-invalid={!!errors.name}
            disabled={isPending}
          />
          {errors.name && <p className="text-sm text-text-danger">{errors.name}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Descrição</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => updateField('description', setDescription, e.target.value)}
            aria-invalid={!!errors.description}
            disabled={isPending}
            rows={4}
          />
          {errors.description && <p className="text-sm text-text-danger">{errors.description}</p>}
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push('/items')}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Salvando...' : mode === 'create' ? 'Criar' : 'Salvar'}
          </Button>
        </div>
      </form>

      {mode === 'edit' && item && (
        <section className="rounded-lg border border-danger-subtle bg-surface-danger-subtle p-4">
          <h2 className="text-sm font-semibold text-text-danger">Danger Zone</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Excluir este item é permanente.
          </p>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="mt-3"
            onClick={() => setIsDeleteOpen(true)}
            disabled={isPending}
          >
            Excluir item
          </Button>
          <DeleteConfirmationDialog
            open={isDeleteOpen}
            onOpenChange={setIsDeleteOpen}
            confirmWord="excluir"
            title="Excluir item"
            description="Esta ação não pode ser desfeita."
            isPending={isPending}
            onConfirm={handleDelete}
          />
        </section>
      )}
    </div>
  );
}
