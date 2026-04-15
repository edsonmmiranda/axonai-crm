'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateOrganizationAction } from '@/lib/actions/organization';

const SLUG_REGEX = /^[a-z0-9](-?[a-z0-9])*$/;

const OrgFormSchema = z.object({
  name: z.string().trim().min(2, 'Nome obrigatório').max(100),
  slug: z
    .string()
    .trim()
    .min(3, 'Slug deve ter ao menos 3 caracteres')
    .max(40)
    .regex(SLUG_REGEX, 'Use apenas minúsculas, números e hífens (sem hífens consecutivos).'),
});

type OrgFormValues = z.infer<typeof OrgFormSchema>;

export interface OrganizationFormProps {
  organization: {
    name: string;
    slug: string;
    plan: string;
    maxUsers: number;
  };
}

export function OrganizationForm({ organization }: OrganizationFormProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isDirty },
    reset,
  } = useForm<OrgFormValues>({
    resolver: zodResolver(OrgFormSchema),
    defaultValues: { name: organization.name, slug: organization.slug },
  });

  const slug = watch('slug');

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const res = await updateOrganizationAction({
        name: values.name,
        slug: values.slug,
      });
      if (!res.success) {
        const message = res.error ?? 'Erro ao atualizar organização.';
        if (message.toLowerCase().includes('slug')) {
          setError('slug', { message });
        } else {
          setFormError(message);
        }
        toast.error(message);
        return;
      }
      toast.success('Organização atualizada.');
      reset(values);
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="orgName" required>
            Nome da organização
          </Label>
          <Input
            id="orgName"
            aria-invalid={errors.name ? true : undefined}
            {...register('name')}
          />
          {errors.name ? (
            <p className="text-xs text-feedback-danger-fg">{errors.name.message}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="orgSlug" required>
            Slug
          </Label>
          <Input
            id="orgSlug"
            autoCapitalize="off"
            autoCorrect="off"
            aria-invalid={errors.slug ? true : undefined}
            {...register('slug')}
          />
          <p className="text-xs text-text-secondary">
            URL pública: <span className="font-mono">app/{slug || 'seu-slug'}</span>
          </p>
          {errors.slug ? (
            <p className="text-xs text-feedback-danger-fg">{errors.slug.message}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="orgPlan">Plano</Label>
          <Input id="orgPlan" value={organization.plan} disabled readOnly />
          <p className="text-xs text-text-secondary">Contate o suporte para alterar.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="orgMaxUsers">Limite de usuários</Label>
          <Input
            id="orgMaxUsers"
            value={String(organization.maxUsers)}
            disabled
            readOnly
          />
          <p className="text-xs text-text-secondary">Definido pelo plano atual.</p>
        </div>
      </div>

      <div className="flex items-center justify-end">
        <Button type="submit" disabled={!isDirty || isPending}>
          {isPending ? 'Salvando…' : 'Salvar alterações'}
        </Button>
      </div>
    </form>
  );
}
