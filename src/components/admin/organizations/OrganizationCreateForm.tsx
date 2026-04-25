'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createOrganizationAction } from '@/lib/actions/admin/organizations';
import { CreateOrgSchema, slugifyName, type CreateOrgInput } from '@/lib/actions/admin/organizations.schemas';

interface PlanOption {
  id: string;
  name: string;
}

interface Props {
  plans: PlanOption[];
}

const selectClasses =
  'h-10 w-full rounded-md border border-field-border bg-field px-3 text-sm text-field-fg transition-all hover:border-field-border-hover focus-visible:border-field-border-focus focus-visible:outline-none focus-visible:shadow-focus';

export function OrganizationCreateForm({ plans }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [signupLink, setSignupLink] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<CreateOrgInput>({
    resolver: zodResolver(CreateOrgSchema),
    defaultValues: { trialDays: 14 },
  });

  function onNameChange(v: string) {
    setValue('name', v);
    // Auto-suggest slug from name
    setValue('slug', slugifyName(v));
  }

  function onSubmit(data: CreateOrgInput) {
    startTransition(async () => {
      const res = await createOrganizationAction(data);
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível criar a organização.');
        return;
      }
      if (res.data?.signupLink) {
        setSignupLink(res.data.signupLink);
      }
      toast.success('Organização criada! Copie e envie o link de convite abaixo.');
      router.push(`/admin/organizations/${res.data?.id}`);
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6 max-w-lg">
      {/* Nome */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="orgName" required>Nome da organização</Label>
        <Input
          id="orgName"
          placeholder="Acme Corp"
          aria-invalid={!!errors.name}
          {...register('name', {
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => onNameChange(e.target.value),
          })}
        />
        {errors.name && <p className="text-xs text-feedback-danger-fg">{errors.name.message}</p>}
      </div>

      {/* Slug */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="orgSlug" required>Slug (URL único)</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted whitespace-nowrap">axon.crm/</span>
          <Input
            id="orgSlug"
            placeholder="acme-corp"
            aria-invalid={!!errors.slug}
            className="font-mono"
            {...register('slug')}
          />
        </div>
        <p className="text-xs text-text-secondary">Lowercase, hífens e números. Imutável após primeiro login.</p>
        {errors.slug && <p className="text-xs text-feedback-danger-fg">{errors.slug.message}</p>}
      </div>

      {/* Plano */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="orgPlan" required>Plano inicial</Label>
        <select
          id="orgPlan"
          aria-invalid={!!errors.planId}
          className={selectClasses}
          {...register('planId')}
        >
          <option value="">Selecione um plano...</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {errors.planId && <p className="text-xs text-feedback-danger-fg">{errors.planId.message}</p>}
      </div>

      {/* E-mail do primeiro admin */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="firstAdminEmail" required>E-mail do primeiro administrador</Label>
        <Input
          id="firstAdminEmail"
          type="email"
          placeholder="admin@empresa.com"
          aria-invalid={!!errors.firstAdminEmail}
          {...register('firstAdminEmail')}
        />
        {errors.firstAdminEmail && <p className="text-xs text-feedback-danger-fg">{errors.firstAdminEmail.message}</p>}
      </div>

      {/* Dias de trial */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="trialDays" required>Dias de trial</Label>
        <Input
          id="trialDays"
          type="number"
          min={1}
          max={365}
          aria-invalid={!!errors.trialDays}
          {...register('trialDays', { valueAsNumber: true })}
        />
        {errors.trialDays && <p className="text-xs text-feedback-danger-fg">{errors.trialDays.message}</p>}
      </div>

      {/* Link de convite (offline fallback) */}
      {signupLink && (
        <div className="rounded-lg border border-feedback-warning-border bg-feedback-warning-bg p-4">
          <p className="text-sm font-semibold text-feedback-warning-fg mb-2">Link de convite (copie e envie manualmente)</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-surface-sunken px-2 py-1 text-xs text-text-primary break-all">{signupLink}</code>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => { void navigator.clipboard.writeText(signupLink); toast.success('Link copiado!'); }}
            >
              Copiar
            </Button>
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Criando...' : 'Criar organização'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
