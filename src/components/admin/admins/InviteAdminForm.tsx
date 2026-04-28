'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Copy, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createInvitationAction } from '@/lib/actions/admin/platform-admins';
import {
  CreateInvitationSchema,
  type CreateInvitationInput,
} from '@/lib/actions/admin/platform-admins.schemas';

const selectClasses =
  'h-10 w-full rounded-md border border-field-border bg-field px-3 text-sm text-field-fg transition-all hover:border-field-border-hover focus-visible:outline-none focus-visible:border-field-border-focus focus-visible:shadow-focus';

interface OfflineState {
  email:       string;
  offlineLink: string;
}

export function InviteAdminForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [offlineState, setOfflineState] = useState<OfflineState | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateInvitationInput>({
    resolver: zodResolver(CreateInvitationSchema),
    defaultValues: { role: 'support' },
  });

  function onSubmit(data: CreateInvitationInput) {
    startTransition(async () => {
      const res = await createInvitationAction(data);
      if (!res.success || !res.data) {
        toast.error(res.error ?? 'Não foi possível criar o convite.');
        return;
      }

      const { invitation, deliveryStatus, offlineLink, errorMessage } = res.data;

      if (deliveryStatus === 'sent') {
        toast.success(`Convite enviado para ${invitation.email}.`);
        reset({ email: '', role: 'support' });
        router.push('/admin/admins?tab=invitations');
        router.refresh();
        return;
      }

      if (deliveryStatus === 'fallback_offline' && offlineLink) {
        toast.warning('Email não configurado — copie o link e envie manualmente.');
        setOfflineState({ email: invitation.email, offlineLink });
        reset({ email: '', role: 'support' });
        router.refresh();
        return;
      }

      toast.error(errorMessage ?? 'Falha no envio do email do convite.');
      router.refresh();
    });
  }

  async function copyOfflineLink() {
    if (!offlineState) return;
    try {
      await navigator.clipboard.writeText(offlineState.offlineLink);
      toast.success('Link copiado!');
    } catch {
      toast.error('Não foi possível copiar o link.');
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-lg flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-email" required>Email do convidado</Label>
        <Input
          id="invite-email"
          type="email"
          autoComplete="off"
          placeholder="pessoa@axon.com"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'invite-email-error' : undefined}
          aria-required="true"
          disabled={isPending}
          {...register('email')}
        />
        {errors.email && (
          <p id="invite-email-error" className="text-xs text-feedback-danger-fg">
            {errors.email.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-role" required>Papel</Label>
        <select
          id="invite-role"
          aria-invalid={!!errors.role}
          aria-required="true"
          className={selectClasses}
          disabled={isPending}
          {...register('role')}
        >
          <option value="owner">Owner — acesso total à plataforma</option>
          <option value="support">Suporte — leitura + ações operacionais</option>
          <option value="billing">Faturamento — assinaturas e cobranças</option>
        </select>
        {errors.role && (
          <p className="text-xs text-feedback-danger-fg">{errors.role.message}</p>
        )}
        <p className="text-xs text-text-secondary">
          O convidado configura senha e MFA ao aceitar. O link expira em 72h.
        </p>
      </div>

      {offlineState && (
        <Alert intent="warning" title="Email não configurado — envie o link manualmente">
          <p className="mb-2">
            Convite criado para{' '}
            <span className="font-semibold text-text-primary">{offlineState.email}</span>.
            Copie e envie o link abaixo via canal seguro:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-surface-sunken px-2 py-1.5 text-xs text-text-primary">
              {offlineState.offlineLink}
            </code>
            <Button type="button" variant="secondary" size="sm" onClick={copyOfflineLink}>
              <Copy className="size-3.5" aria-hidden="true" />
              Copiar
            </Button>
          </div>
        </Alert>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          <Send className="size-4" aria-hidden="true" />
          {isPending ? 'Enviando convite...' : 'Enviar convite'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push('/admin/admins')}
          disabled={isPending}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
