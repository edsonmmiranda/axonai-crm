'use client';

import { useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { updateProfileAction } from '@/lib/actions/profile';
import { AvatarUploader } from '@/components/settings/AvatarUploader';

const ProfileFormSchema = z.object({
  fullName: z.string().trim().min(2, 'Nome obrigatório').max(100),
  phone: z.string().trim().max(20).optional().or(z.literal('')),
  emailNotifications: z.boolean(),
});

type ProfileFormValues = z.infer<typeof ProfileFormSchema>;

export interface ProfileFormProps {
  profile: {
    fullName: string;
    phone: string | null;
    avatarUrl: string | null;
    email: string | null;
    preferences: { emailNotifications?: boolean } | null;
  };
}

export function ProfileForm({ profile }: ProfileFormProps) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatarUrl);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(ProfileFormSchema),
    defaultValues: {
      fullName: profile.fullName,
      phone: profile.phone ?? '',
      emailNotifications: profile.preferences?.emailNotifications ?? true,
    },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const res = await updateProfileAction({
        fullName: values.fullName,
        phone: values.phone,
        avatarUrl,
        preferences: { emailNotifications: values.emailNotifications },
      });
      if (!res.success) {
        setFormError(res.error ?? 'Erro ao atualizar perfil.');
        toast.error(res.error ?? 'Erro ao atualizar perfil.');
        return;
      }
      toast.success('Perfil atualizado.');
      reset(values);
    });
  });

  const dirty = isDirty || avatarUrl !== profile.avatarUrl;

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

      <AvatarUploader value={avatarUrl} fullName={profile.fullName} onChange={setAvatarUrl} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fullName" required>
            Nome completo
          </Label>
          <Input
            id="fullName"
            autoComplete="name"
            aria-invalid={errors.fullName ? true : undefined}
            {...register('fullName')}
          />
          {errors.fullName ? (
            <p className="text-xs text-feedback-danger-fg">{errors.fullName.message}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={profile.email ?? ''} disabled readOnly />
          <p className="text-xs text-text-secondary">
            Alterar email exige contato com suporte.
          </p>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="phone">Telefone</Label>
          <Input
            id="phone"
            type="tel"
            autoComplete="tel"
            placeholder="(11) 99999-9999"
            aria-invalid={errors.phone ? true : undefined}
            {...register('phone')}
          />
          {errors.phone ? (
            <p className="text-xs text-feedback-danger-fg">{errors.phone.message}</p>
          ) : null}
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3">
        <div>
          <p className="text-sm font-medium text-text-primary">Notificações por email</p>
          <p className="text-xs text-text-secondary">
            Receba alertas sobre atualizações importantes da sua organização.
          </p>
        </div>
        <Controller
          control={control}
          name="emailNotifications"
          render={({ field }) => (
            <Switch
              checked={field.value}
              onCheckedChange={field.onChange}
              aria-label="Ativar notificações por email"
            />
          )}
        />
      </div>

      <div className="flex items-center justify-end">
        <Button type="submit" disabled={!dirty || isPending}>
          {isPending ? 'Salvando…' : 'Salvar alterações'}
        </Button>
      </div>
    </form>
  );
}
