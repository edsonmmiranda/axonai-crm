'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { slugify } from '@/lib/actions/_shared/slugify';
import {
  createCategoryAction,
  updateCategoryAction,
  type CategoryRow,
} from '@/lib/actions/categories';

const FormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Nome deve ter ao menos 2 caracteres')
    .max(80, 'Nome deve ter no máximo 80 caracteres'),
  description: z
    .string()
    .trim()
    .max(500, 'Descrição deve ter no máximo 500 caracteres')
    .optional(),
  is_active: z.boolean(),
});

type FormValues = z.infer<typeof FormSchema>;

export interface CategoryFormProps {
  mode: 'create' | 'edit';
  category?: CategoryRow;
  isAdmin?: boolean;
}

export function CategoryForm({ mode, category, isAdmin = false }: CategoryFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    watch,
    control,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: category?.name ?? '',
      description: category?.description ?? '',
      is_active: category?.is_active ?? true,
    },
  });

  const nameValue = watch('name');
  const slugPreview = category?.slug ?? (slugify(nameValue ?? '') || 'auto-gerado');

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const payload = {
        name: values.name,
        description: values.description || undefined,
        is_active: values.is_active,
      };

      const res =
        mode === 'create'
          ? await createCategoryAction(payload)
          : await updateCategoryAction(category!.id, payload);

      if (!res.success) {
        const message = res.error ?? 'Não foi possível salvar a categoria.';
        if (message.toLowerCase().includes('nome')) {
          setError('name', { message });
        } else if (message.toLowerCase().includes('descri')) {
          setError('description', { message });
        } else {
          setFormError(message);
        }
        toast.error(message);
        return;
      }

      toast.success(mode === 'create' ? 'Categoria criada.' : 'Categoria atualizada.');
      router.push('/settings/catalog/categories');
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      {formError ? (
        <div
          role="alert"
          className="rounded-md border border-feedback-danger-border bg-feedback-danger-bg px-4 py-3 text-sm text-feedback-danger-fg"
        >
          {formError}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="categoryName" required>
          Nome
        </Label>
        <Input
          id="categoryName"
          aria-invalid={errors.name ? true : undefined}
          placeholder="Ex.: Eletrônicos"
          {...register('name')}
        />
        {errors.name ? (
          <p className="text-xs text-feedback-danger-fg">{errors.name.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="categorySlug">Slug</Label>
        <Input
          id="categorySlug"
          value={slugPreview}
          disabled
          readOnly
          className="font-mono"
        />
        <p className="text-xs text-text-secondary">
          Gerado automaticamente a partir do nome. Usado em URLs.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="categoryDescription">Descrição</Label>
        <Textarea
          id="categoryDescription"
          aria-invalid={errors.description ? true : undefined}
          placeholder="Explique o que essa categoria agrupa."
          {...register('description')}
        />
        {errors.description ? (
          <p className="text-xs text-feedback-danger-fg">{errors.description.message}</p>
        ) : null}
      </div>

      {mode === 'edit' && isAdmin ? (
        <div className="flex items-center justify-between rounded-md border border-border bg-surface-raised px-4 py-3">
          <div className="flex flex-col">
            <Label htmlFor="categoryActive">Categoria ativa</Label>
            <p className="text-xs text-text-secondary">
              Categorias inativas ficam ocultas no catálogo por padrão.
            </p>
          </div>
          <Controller
            control={control}
            name="is_active"
            render={({ field }) => (
              <Switch
                id="categoryActive"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push('/settings/catalog/categories')}
          disabled={isPending}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={isPending || (mode === 'edit' && !isDirty)}>
          {isPending
            ? 'Salvando…'
            : mode === 'create'
              ? 'Criar categoria'
              : 'Salvar alterações'}
        </Button>
      </div>
    </form>
  );
}
