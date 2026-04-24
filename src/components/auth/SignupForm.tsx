'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { signupWithOrgAction } from '@/lib/actions/auth';

const Schema = z.object({
  fullName: z.string().min(2, 'Nome obrigatório').max(100),
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres').max(72),
  orgName: z.string().min(2, 'Nome da organização obrigatório').max(100),
  orgSlug: z
    .string()
    .min(3, 'Mínimo 3 caracteres')
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'Apenas letras minúsculas, números e hífens'),
});
type Input_ = z.infer<typeof Schema>;

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function SignupForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const slugTouched = useRef(false);

  const form = useForm<Input_>({
    resolver: zodResolver(Schema),
    defaultValues: { fullName: '', email: '', password: '', orgName: '', orgSlug: '' },
  });

  const orgName = form.watch('orgName');
  useEffect(() => {
    if (slugTouched.current) return;
    form.setValue('orgSlug', slugify(orgName ?? ''), { shouldValidate: false });
  }, [orgName, form]);

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const res = await signupWithOrgAction(values);
      if (!res.success) {
        setFormError(res.error ?? 'Erro ao criar conta');
        return;
      }
      router.replace(`/check-email?email=${encodeURIComponent(values.email)}`);
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

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-fullName" required>
          Seu nome
        </Label>
        <Input
          id="signup-fullName"
          autoComplete="name"
          aria-invalid={!!errors.fullName}
          {...form.register('fullName')}
        />
        {errors.fullName && (
          <p className="text-xs text-feedback-danger-fg">{errors.fullName.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-email" required>
          Email
        </Label>
        <Input
          id="signup-email"
          type="email"
          autoComplete="email"
          aria-invalid={!!errors.email}
          {...form.register('email')}
        />
        {errors.email && <p className="text-xs text-feedback-danger-fg">{errors.email.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-password" required>
          Senha
        </Label>
        <Input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.password}
          {...form.register('password')}
        />
        {errors.password && (
          <p className="text-xs text-feedback-danger-fg">{errors.password.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-orgName" required>
          Nome da organização
        </Label>
        <Input
          id="signup-orgName"
          aria-invalid={!!errors.orgName}
          {...form.register('orgName')}
        />
        {errors.orgName && (
          <p className="text-xs text-feedback-danger-fg">{errors.orgName.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-orgSlug" required>
          Slug da organização
        </Label>
        <Input
          id="signup-orgSlug"
          aria-invalid={!!errors.orgSlug}
          {...form.register('orgSlug', {
            onChange: () => {
              slugTouched.current = true;
            },
          })}
        />
        <p className="text-xs text-text-secondary">
          Usado em URLs. Apenas letras minúsculas, números e hífens.
        </p>
        {errors.orgSlug && (
          <p className="text-xs text-feedback-danger-fg">{errors.orgSlug.message}</p>
        )}
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? 'Criando…' : 'Criar conta'}
      </Button>
    </form>
  );
}
