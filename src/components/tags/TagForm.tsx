'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import { AlertTriangle, Check, Tag, Trash2 } from 'lucide-react';

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
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  createTagAction,
  updateTagAction,
  deleteTagAction,
  type TagRow,
} from '@/lib/actions/tags';
import { TAG_COLORS, type TagColor } from '@/lib/tags/constants';
import { TagBadge } from './TagBadge';

const COLOR_LABELS: Record<TagColor, string> = {
  gray: 'Cinza',
  red: 'Vermelho',
  orange: 'Laranja',
  yellow: 'Amarelo',
  green: 'Verde',
  teal: 'Verde-azulado',
  blue: 'Azul',
  indigo: 'Índigo',
  purple: 'Roxo',
  pink: 'Rosa',
};

const FormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Nome deve ter ao menos 2 caracteres')
    .max(50, 'Nome deve ter no máximo 50 caracteres'),
  color: z.enum(TAG_COLORS),
  is_active: z.boolean(),
});

type FormValues = z.infer<typeof FormSchema>;

export interface TagFormProps {
  mode: 'create' | 'edit';
  tag?: TagRow;
  isAdmin?: boolean;
}

export function TagForm({ mode, tag, isAdmin = false }: TagFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, startDeleteTransition] = useTransition();

  const {
    register,
    handleSubmit,
    control,
    watch,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: tag?.name ?? '',
      color: (tag?.color as TagColor) ?? 'gray',
      is_active: tag?.is_active ?? true,
    },
  });

  const watchedName = watch('name');
  const watchedColor = watch('color');

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const res =
        mode === 'create'
          ? await createTagAction({ name: values.name, color: values.color })
          : await updateTagAction(tag!.id, {
              name: values.name,
              color: values.color,
              is_active: values.is_active,
            });

      if (!res.success) {
        const message = res.error ?? 'Não foi possível salvar a tag.';
        if (message.toLowerCase().includes('nome') || message.toLowerCase().includes('tag com este nome')) {
          setError('name', { message });
        } else {
          setFormError(message);
        }
        toast.error(message);
        return;
      }

      toast.success(mode === 'create' ? 'Tag criada.' : 'Tag atualizada.');
      router.push('/leads-tags');
    });
  });

  function handleDelete() {
    startDeleteTransition(async () => {
      const res = await deleteTagAction(tag!.id);
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível excluir a tag.');
        setShowDeleteDialog(false);
        return;
      }
      toast.success('Tag excluída.');
      router.push('/leads-tags');
    });
  }

  return (
    <>
      <form id="tag-form" onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
        {formError ? (
          <div
            role="alert"
            className="rounded-md border border-feedback-danger-border bg-feedback-danger-bg px-4 py-3 text-sm text-feedback-danger-fg"
          >
            {formError}
          </div>
        ) : null}

        {/* Form Card Section */}
        <div className="rounded-xl border border-border bg-surface-raised p-6 shadow-sm md:p-8">
          <div className="mb-6 flex items-center gap-3 border-b border-border-subtle pb-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-feedback-info-bg text-feedback-info-fg">
              <Tag className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-text-primary">Informações da Tag</h3>
              <p className="text-sm text-text-secondary">
                Dados de identificação da tag para classificação de leads.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tagName" required>
                Nome
              </Label>
              <Input
                id="tagName"
                aria-invalid={errors.name ? true : undefined}
                placeholder="Ex.: VIP"
                {...register('name')}
              />
              {errors.name ? (
                <p className="text-xs text-feedback-danger-fg">{errors.name.message}</p>
              ) : null}
            </div>

            {/* Color Picker */}
            <div className="flex flex-col gap-1.5">
              <Label required>Cor</Label>
              <Controller
                control={control}
                name="color"
                render={({ field }) => (
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor da tag">
                    {TAG_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={field.value === c}
                        aria-label={COLOR_LABELS[c]}
                        onClick={() => field.onChange(c)}
                        className={cn(
                          'relative flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:shadow-focus',
                          field.value === c
                            ? 'border-action-primary bg-action-primary/10 text-action-primary'
                            : 'border-border bg-surface-raised text-text-secondary hover:bg-surface-sunken',
                        )}
                      >
                        <TagBadge name={COLOR_LABELS[c]} color={c} />
                        {field.value === c ? (
                          <Check className="size-3.5 text-action-primary" aria-hidden="true" />
                        ) : null}
                      </button>
                    ))}
                  </div>
                )}
              />
              {errors.color ? (
                <p className="text-xs text-feedback-danger-fg">{errors.color.message}</p>
              ) : null}
            </div>

            {/* Preview */}
            <div className="flex flex-col gap-1.5">
              <Label>Pré-visualização</Label>
              <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-sunken px-4 py-3">
                <TagBadge
                  name={watchedName || 'Nome da tag'}
                  color={watchedColor}
                />
              </div>
            </div>

            {/* Active switch (edit only) */}
            {mode === 'edit' && isAdmin ? (
              <div className="flex items-center justify-between rounded-md border border-border bg-surface-sunken px-4 py-3">
                <div className="flex flex-col">
                  <Label htmlFor="tagActive">Tag ativa</Label>
                  <p className="text-xs text-text-secondary">
                    Tags inativas ficam ocultas na listagem padrão e não podem ser vinculadas a novos leads.
                  </p>
                </div>
                <Controller
                  control={control}
                  name="is_active"
                  render={({ field }) => (
                    <Switch
                      id="tagActive"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </div>
            ) : null}
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push('/leads-tags')}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending || (mode === 'edit' && !isDirty)}>
            {isPending
              ? 'Salvando...'
              : mode === 'create'
                ? 'Criar tag'
                : 'Salvar alterações'}
          </Button>
        </div>
      </form>

      {/* Danger Zone — edit only */}
      {mode === 'edit' && tag ? (
        <div className="rounded-xl border border-feedback-danger-border bg-feedback-danger-bg p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-lg bg-feedback-danger-solid-bg text-feedback-danger-solid-fg">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-text-primary">Zona de Perigo</h3>
              <p className="mt-1 text-sm text-text-secondary">
                Excluir esta tag a remove permanentemente do sistema. Tags vinculadas a leads
                não podem ser excluídas — desative-as em vez disso.
              </p>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmText('');
                    setShowDeleteDialog(true);
                  }}
                  className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-action-danger px-4 text-sm font-bold text-action-danger-fg shadow-sm transition-colors hover:bg-action-danger-hover focus-visible:outline-none focus-visible:shadow-focus"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Excluir tag
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog ? (
        <Dialog open onOpenChange={(open) => !open && setShowDeleteDialog(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Excluir tag</DialogTitle>
              <DialogDescription>
                Esta ação não pode ser desfeita. A tag{' '}
                <span className="font-semibold text-text-primary">{tag?.name}</span> será
                excluída permanentemente. Se ela estiver vinculada a leads, a exclusão será bloqueada.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1.5 py-2">
              <Label htmlFor="confirmDeleteTag">
                Digite <span className="font-semibold">excluir</span> para confirmar
              </Label>
              <Input
                id="confirmDeleteTag"
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
                {isDeleting ? 'Excluindo...' : 'Excluir tag'}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
