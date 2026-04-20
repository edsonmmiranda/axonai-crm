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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  createLeadOriginAction,
  updateLeadOriginAction,
  type LeadOriginRow,
} from '@/lib/actions/lead-origins';

const TYPE_OPTIONS = [
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'referral', label: 'Indicação' },
  { value: 'social', label: 'Redes Sociais' },
  { value: 'evento', label: 'Evento' },
  { value: 'outro', label: 'Outro' },
];

const FormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Nome deve ter ao menos 2 caracteres')
    .max(100, 'Nome deve ter no máximo 100 caracteres'),
  type: z
    .string()
    .trim()
    .min(1, 'Tipo é obrigatório'),
  platform: z
    .string()
    .trim()
    .max(100, 'Plataforma deve ter no máximo 100 caracteres')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  is_active: z.boolean(),
});

type FormValues = z.infer<typeof FormSchema>;

export interface LeadOriginFormProps {
  mode: 'create' | 'edit';
  origin?: LeadOriginRow;
  isAdmin?: boolean;
}

export function LeadOriginForm({ mode, origin, isAdmin = false }: LeadOriginFormProps) {
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
      name: origin?.name ?? '',
      type: origin?.type ?? '',
      platform: origin?.platform ?? '',
      is_active: origin?.is_active ?? true,
    },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const payload = {
        name: values.name,
        type: values.type,
        platform: values.platform || undefined,
        is_active: values.is_active,
      };

      const res =
        mode === 'create'
          ? await createLeadOriginAction(payload)
          : await updateLeadOriginAction(origin!.id, payload);

      if (!res.success) {
        const message = res.error ?? 'Não foi possível salvar a origem.';
        if (message.toLowerCase().includes('nome')) {
          setError('name', { message });
        } else if (message.toLowerCase().includes('tipo')) {
          setError('type', { message });
        } else {
          setFormError(message);
        }
        toast.error(message);
        return;
      }

      toast.success(mode === 'create' ? 'Origem criada.' : 'Origem atualizada.');
      router.push('/leads/origins');
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
        <Label htmlFor="originName" required>
          Nome
        </Label>
        <Input
          id="originName"
          aria-invalid={errors.name ? true : undefined}
          placeholder="Ex.: Google Ads"
          {...register('name')}
        />
        {errors.name ? (
          <p className="text-xs text-feedback-danger-fg">{errors.name.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="originType" required>
          Tipo
        </Label>
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger
                id="originType"
                aria-invalid={errors.type ? true : undefined}
              >
                <SelectValue placeholder="Selecione o tipo" />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.type ? (
          <p className="text-xs text-feedback-danger-fg">{errors.type.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="originPlatform">Plataforma</Label>
        <Input
          id="originPlatform"
          aria-invalid={errors.platform ? true : undefined}
          placeholder="Ex.: Meta Ads, LinkedIn, Site"
          {...register('platform')}
        />
        <p className="text-xs text-text-secondary">
          Opcional. Especifique a plataforma ou canal de origem.
        </p>
        {errors.platform ? (
          <p className="text-xs text-feedback-danger-fg">{errors.platform.message}</p>
        ) : null}
      </div>

      {mode === 'edit' && isAdmin ? (
        <div className="flex items-center justify-between rounded-md border border-border bg-surface-raised px-4 py-3">
          <div className="flex flex-col">
            <Label htmlFor="originActive">Origem ativa</Label>
            <p className="text-xs text-text-secondary">
              Origens inativas ficam ocultas na listagem padrão.
            </p>
          </div>
          <Controller
            control={control}
            name="is_active"
            render={({ field }) => (
              <Switch
                id="originActive"
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
          onClick={() => router.push('/leads/origins')}
          disabled={isPending}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={isPending || (mode === 'edit' && !isDirty)}>
          {isPending
            ? 'Salvando...'
            : mode === 'create'
              ? 'Criar origem'
              : 'Salvar alterações'}
        </Button>
      </div>
    </form>
  );
}
