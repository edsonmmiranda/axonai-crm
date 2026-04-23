'use client';

import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { loginWithPasswordAction, sendMagicLinkAction } from '@/lib/actions/auth';

const PasswordSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Senha obrigatória'),
});
const MagicSchema = z.object({ email: z.string().email('Email inválido') });

type PasswordInput = z.infer<typeof PasswordSchema>;
type MagicInput = z.infer<typeof MagicSchema>;

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get('redirectTo') ?? '/dashboard';
  const initialError =
    params.get('error') === 'inconsistent'
      ? 'Sua sessão estava inconsistente. Faça login novamente.'
      : params.get('error') === 'invalid_code'
        ? 'Link inválido ou expirado. Peça um novo.'
        : params.get('error') === 'invalid_callback'
          ? 'Retorno inválido. Tente novamente.'
          : null;
  const justActivated = params.get('activated') === '1';

  const [formError, setFormError] = useState<string | null>(initialError);
  const [magicSent, setMagicSent] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const passwordForm = useForm<PasswordInput>({
    resolver: zodResolver(PasswordSchema),
    defaultValues: { email: '', password: '' },
  });
  const magicForm = useForm<MagicInput>({
    resolver: zodResolver(MagicSchema),
    defaultValues: { email: '' },
  });

  const onPasswordSubmit = passwordForm.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const res = await loginWithPasswordAction(values);
      if (!res.success) {
        setFormError(res.error ?? 'Erro ao entrar');
        return;
      }
      router.replace(redirectTo);
      router.refresh();
    });
  });

  const onMagicSubmit = magicForm.handleSubmit((values) => {
    setFormError(null);
    setMagicSent(null);
    startTransition(async () => {
      const res = await sendMagicLinkAction(values);
      if (!res.success) {
        setFormError(res.error ?? 'Erro ao enviar link');
        return;
      }
      setMagicSent(values.email);
    });
  });

  return (
    <div className="flex flex-col gap-4">
      {justActivated && !formError && (
        <Alert intent="success" title="Conta ativada!">
          Pronto. Agora faça login com seu email e senha.
        </Alert>
      )}
      {formError && (
        <Alert intent="danger" role="alert">
          {formError}
        </Alert>
      )}
      <Tabs defaultValue="password">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="password">Senha</TabsTrigger>
          <TabsTrigger value="magic">Magic Link</TabsTrigger>
        </TabsList>

        <TabsContent value="password">
          <form onSubmit={onPasswordSubmit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-email" required>
                Email
              </Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                aria-invalid={!!passwordForm.formState.errors.email}
                {...passwordForm.register('email')}
              />
              {passwordForm.formState.errors.email && (
                <p className="text-xs text-feedback-danger-fg">
                  {passwordForm.formState.errors.email.message}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-password" required>
                Senha
              </Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!passwordForm.formState.errors.password}
                {...passwordForm.register('password')}
              />
              {passwordForm.formState.errors.password && (
                <p className="text-xs text-feedback-danger-fg">
                  {passwordForm.formState.errors.password.message}
                </p>
              )}
            </div>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="magic">
          {magicSent ? (
            <Alert intent="success" title="Verifique seu email">
              Enviamos um link de acesso para <strong>{magicSent}</strong>. Abra no mesmo dispositivo para entrar.
            </Alert>
          ) : (
            <form onSubmit={onMagicSubmit} className="flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="magic-email" required>
                  Email
                </Label>
                <Input
                  id="magic-email"
                  type="email"
                  autoComplete="email"
                  aria-invalid={!!magicForm.formState.errors.email}
                  {...magicForm.register('email')}
                />
                {magicForm.formState.errors.email && (
                  <p className="text-xs text-feedback-danger-fg">
                    {magicForm.formState.errors.email.message}
                  </p>
                )}
              </div>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Enviando…' : 'Enviar link'}
              </Button>
            </form>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
