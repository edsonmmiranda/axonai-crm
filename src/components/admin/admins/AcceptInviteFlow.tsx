'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { consumeInvitationAction } from '@/lib/actions/admin/platform-admins';
import { createClient } from '@/lib/supabase/client';

import { roleLabel } from './formatters';

const FormSchema = z
  .object({
    password:        z.string().min(8, 'A senha deve ter ao menos 8 caracteres').max(128),
    passwordConfirm: z.string().min(8, 'Confirme a senha'),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: 'As senhas não coincidem',
    path:    ['passwordConfirm'],
  });

type FormValues = z.input<typeof FormSchema>;

interface Props {
  email: string;
  role:  'owner' | 'support' | 'billing';
  token: string;
}

interface SessionConflict {
  email: string;
}

export function AcceptInviteFlow({ email, role, token }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [sessionConflict, setSessionConflict] = useState<SessionConflict | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
  });

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      const sessionEmail = data.user?.email?.toLowerCase();
      if (sessionEmail && sessionEmail !== email.toLowerCase()) {
        setSessionConflict({ email: sessionEmail });
      }
      setIsCheckingSession(false);
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [email]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setSessionConflict(null);
    router.refresh();
  }

  function onSubmit(data: FormValues) {
    startTransition(async () => {
      const res = await consumeInvitationAction({ token, password: data.password });
      if (!res.success || !res.data) {
        toast.error(res.error ?? 'Não foi possível concluir o aceite.');
        return;
      }
      toast.success('Conta criada! Configure agora seu MFA.');
      router.push(res.data.redirectTo);
    });
  }

  if (isCheckingSession) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-text-secondary">
        <p className="text-sm">Verificando sessão atual…</p>
      </div>
    );
  }

  if (sessionConflict) {
    return (
      <div className="flex flex-col gap-5">
        <Alert intent="danger" title="Conflito de sessão">
          <p className="mb-2">
            Você está logado como{' '}
            <span className="font-semibold text-text-primary">{sessionConflict.email}</span>,
            mas este convite é para{' '}
            <span className="font-semibold text-text-primary">{email}</span>. Faça logout
            antes de continuar.
          </p>
        </Alert>
        <Button type="button" onClick={handleSignOut}>
          <LogOut className="size-4" aria-hidden="true" />
          Sair e tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
      <div className="rounded-md border border-border bg-surface-sunken px-4 py-3">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
          <CheckCircle2 className="size-4 text-feedback-success-fg" aria-hidden="true" />
          Convite válido
        </p>
        <p className="mt-1 text-sm text-text-primary">
          Bem-vindo! Você foi convidado como{' '}
          <span className="font-semibold">{roleLabel(role)}</span> da plataforma Axon.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-email" required>Email</Label>
        <Input
          id="invite-email"
          type="email"
          value={email}
          disabled
          readOnly
          aria-readonly="true"
        />
        <p className="text-xs text-text-secondary">
          Este link é exclusivo para esse email — não é possível alterar.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-password" required>Crie sua senha</Label>
        <Input
          id="invite-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          aria-invalid={!!errors.password}
          aria-required="true"
          disabled={isPending}
          {...register('password')}
        />
        {errors.password && (
          <p className="text-xs text-feedback-danger-fg">{errors.password.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-password-confirm" required>Confirme a senha</Label>
        <Input
          id="invite-password-confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          aria-invalid={!!errors.passwordConfirm}
          aria-required="true"
          disabled={isPending}
          {...register('passwordConfirm')}
        />
        {errors.passwordConfirm && (
          <p className="text-xs text-feedback-danger-fg">{errors.passwordConfirm.message}</p>
        )}
      </div>

      <Alert intent="info" title="Próximo passo: configurar MFA">
        Após criar sua senha, você será direcionado para configurar a autenticação em 2 fatores
        (TOTP). MFA é obrigatório para acessar a área admin.
      </Alert>

      <Button type="submit" size="lg" disabled={isPending} className="w-full">
        {isPending ? (
          <>
            <KeyRound className="size-5 animate-pulse" aria-hidden="true" />
            Criando conta…
          </>
        ) : (
          <>
            <ShieldCheck className="size-5" aria-hidden="true" />
            Criar conta e configurar MFA
          </>
        )}
      </Button>
    </form>
  );
}
