'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { resendSignupConfirmationAction } from '@/lib/actions/auth';

const Schema = z.object({
  email: z.string().email('Email inválido'),
});
type Input_ = z.infer<typeof Schema>;

export function ResendConfirmationForm() {
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const form = useForm<Input_>({
    resolver: zodResolver(Schema),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    setSentTo(null);
    startTransition(async () => {
      const res = await resendSignupConfirmationAction(values);
      if (!res.success) {
        setFormError(res.error ?? 'Não foi possível reenviar o link');
        return;
      }
      setSentTo(values.email);
    });
  });

  if (sentTo) {
    return (
      <Alert intent="success" title="Pronto">
        Se existir uma conta pendente para <strong>{sentTo}</strong>, um novo email foi enviado. Verifique sua caixa de entrada e spam.
      </Alert>
    );
  }

  const errors = form.formState.errors;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {formError && (
        <Alert intent="danger" role="alert">
          {formError}
        </Alert>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="resend-email" required>
          Email
        </Label>
        <Input
          id="resend-email"
          type="email"
          autoComplete="email"
          aria-invalid={!!errors.email}
          {...form.register('email')}
        />
        {errors.email && <p className="text-xs text-feedback-danger-fg">{errors.email.message}</p>}
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? 'Enviando…' : 'Reenviar link de ativação'}
      </Button>
    </form>
  );
}
