'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { signupWithInviteAction } from '@/lib/actions/auth';

const Schema = z.object({
  fullName: z.string().min(2, 'Nome obrigatório').max(100),
  password: z.string().min(8, 'Mínimo 8 caracteres').max(72),
});
type Input_ = z.infer<typeof Schema>;

interface Props {
  inviteToken: string;
  email: string;
  organizationName: string;
}

export function AcceptInviteForm({ inviteToken, email, organizationName }: Props) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const form = useForm<Input_>({
    resolver: zodResolver(Schema),
    defaultValues: { fullName: '', password: '' },
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const res = await signupWithInviteAction({ ...values, inviteToken });
      if (!res.success) {
        setFormError(res.error ?? 'Erro ao aceitar convite');
        return;
      }
      router.replace(`/signup/check-email?email=${encodeURIComponent(email)}`);
    });
  });

  const errors = form.formState.errors;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {formError && (
        <Alert intent="danger" role="alert">
          {formError}
        </Alert>
      )}

      <Alert intent="info">
        Você está entrando em <strong>{organizationName}</strong>.
      </Alert>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-email">Email</Label>
        <Input id="invite-email" type="email" value={email} readOnly disabled />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-fullName" required>
          Seu nome
        </Label>
        <Input
          id="invite-fullName"
          autoComplete="name"
          aria-invalid={!!errors.fullName}
          {...form.register('fullName')}
        />
        {errors.fullName && (
          <p className="text-xs text-feedback-danger-fg">{errors.fullName.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-password" required>
          Senha
        </Label>
        <Input
          id="invite-password"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.password}
          {...form.register('password')}
        />
        {errors.password && (
          <p className="text-xs text-feedback-danger-fg">{errors.password.message}</p>
        )}
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? 'Aceitando…' : 'Aceitar convite'}
      </Button>
    </form>
  );
}
