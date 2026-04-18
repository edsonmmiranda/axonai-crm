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
import {
  createLossReasonAction,
  updateLossReasonAction,
  type LossReasonRow,
} from '@/lib/actions/loss-reasons';

const FormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Nome deve ter ao menos 2 caracteres')
    .max(100, 'Nome deve ter no máximo 100 caracteres'),
  is_active: z.boolean(),
});

type FormValues = z.infer<typeof FormSchema>;

export interface LossReasonFormProps {
  mode: 'create' | 'edit';
  reason?: LossReasonRow;
}

export function LossReasonForm({ mode, reason }: LossReasonFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: reason?.name ?? '',
      is_active: reason?.is_active ?? true,
    },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const payload = {
        name: values.name,
        is_active: values.is_active,
      };

      const res =
        mode === 'create'
          ? await createLossReasonAction(payload)
          : await updateLossReasonAction(reason!.id, payload);

      if (!res.success) {
        const message = res.error ?? 'Não foi possível salvar o motivo de perda.';
        if (message.toLowerCase().includes('nome')) {
          setError('name', { message });
        } else {
          setFormError(message);
        }
        toast.error(message);
        return;
      }

      toast.success(mode === 'create' ? 'Motivo de perda criado.' : 'Motivo de perda atualizado.');
      router.push('/leads/loss-reasons');
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
        <Label htmlFor="reasonName" required>
          Nome
        </Label>
        <Input
          id="reasonName"
          aria-invalid={errors.name ? true : undefined}
          placeholder="Ex.: Preço alto"
          {...register('name')}
        />
        {errors.name ? (
          <p className="text-xs text-feedback-danger-fg">{errors.name.message}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-between rounded-md border border-border bg-surface-raised px-4 py-3">
        <div className="flex flex-col">
          <Label htmlFor="reasonActive">Motivo ativo</Label>
          <p className="text-xs text-text-secondary">
            Motivos inativos ficam ocultos na listagem padrão.
          </p>
        </div>
        <Controller
          control={control}
          name="is_active"
          render={({ field }) => (
            <Switch
              id="reasonActive"
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push('/leads/loss-reasons')}
          disabled={isPending}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={isPending || (mode === 'edit' && !isDirty)}>
          {isPending
            ? 'Salvando...'
            : mode === 'create'
              ? 'Criar motivo'
              : 'Salvar alterações'}
        </Button>
      </div>
    </form>
  );
}
