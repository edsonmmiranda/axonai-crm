'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  createIntegrationCredentialAction,
  rotateIntegrationCredentialAction,
} from '@/lib/actions/admin/integration-credentials';
import type { IntegrationCredentialView } from '@/lib/actions/admin/integration-credentials.schemas';

const formSchema = z.object({
  label:     z.string().trim().min(1, 'Informe um label.').max(80, 'Máximo 80 caracteres.'),
  host:      z.string().trim().min(1, 'Informe o host SMTP.').max(255),
  port:      z.number().int().min(1).max(65535),
  user:      z.string().trim().min(1, 'Informe o usuário SMTP.').max(255),
  secure:    z.boolean(),
  fromEmail: z.string().trim().email('Email inválido.').max(320),
  secretPlaintext: z.string().min(1, 'Informe a senha SMTP.').max(500),
});

type FormValues = z.infer<typeof formSchema>;

interface Props {
  existing:  IntegrationCredentialView | null;
  canMutate: boolean;
}

export function IntegrationCredentialForm({ existing, canMutate }: Props) {
  const router = useRouter();
  const isRotate = existing !== null;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      label:     existing?.label     ?? '',
      host:      existing?.metadata.host      ?? '',
      port:      existing?.metadata.port      ?? 587,
      user:      existing?.metadata.user      ?? '',
      secure:    existing?.metadata.secure    ?? false,
      fromEmail: existing?.metadata.fromEmail ?? '',
      secretPlaintext: '',
    },
  });

  const secureValue = watch('secure');

  async function onSubmit(values: FormValues) {
    const metadata = {
      host:      values.host,
      port:      values.port,
      user:      values.user,
      secure:    values.secure,
      fromEmail: values.fromEmail,
    };

    if (isRotate && existing) {
      const res = await rotateIntegrationCredentialAction({
        id:                 existing.id,
        newSecretPlaintext: values.secretPlaintext,
        newMetadata:        metadata,
      });
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível rotacionar a credencial.');
        return;
      }
      toast.success('Credencial rotacionada.');
      router.refresh();
    } else {
      const res = await createIntegrationCredentialAction({
        kind:            'email_smtp',
        label:           values.label,
        metadata,
        secretPlaintext: values.secretPlaintext,
      });
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível cadastrar a credencial.');
        return;
      }
      toast.success('Credencial configurada.');
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isRotate ? 'Rotacionar credencial SMTP' : 'Configurar SMTP'}</CardTitle>
        <CardDescription>
          {isRotate
            ? 'A credencial atual é substituída na próxima utilização. O hint anterior fica registrado no audit log.'
            : 'Cadastre o SMTP transacional. A senha é cifrada no Supabase Vault e nunca volta para a interface.'}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cred-label" required>Label</Label>
            <p className="text-xs text-text-muted">
              Nome humano-legível para o operador identificar esta credencial.
            </p>
            <Input
              id="cred-label"
              type="text"
              placeholder="Production SMTP — Brevo"
              disabled={!canMutate || isRotate}
              aria-invalid={errors.label ? 'true' : undefined}
              {...register('label')}
            />
            {errors.label && (
              <p className="text-xs text-feedback-danger-fg">{errors.label.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="cred-host" required>Host</Label>
              <Input
                id="cred-host"
                type="text"
                placeholder="smtp.brevo.com"
                disabled={!canMutate}
                aria-invalid={errors.host ? 'true' : undefined}
                {...register('host')}
              />
              {errors.host && (
                <p className="text-xs text-feedback-danger-fg">{errors.host.message}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cred-port" required>Porta</Label>
              <Input
                id="cred-port"
                type="number"
                min={1}
                max={65535}
                disabled={!canMutate}
                aria-invalid={errors.port ? 'true' : undefined}
                {...register('port', { valueAsNumber: true })}
              />
              {errors.port && (
                <p className="text-xs text-feedback-danger-fg">{errors.port.message}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cred-user" required>Usuário</Label>
            <Input
              id="cred-user"
              type="text"
              placeholder="api@axonai.com"
              autoComplete="off"
              disabled={!canMutate}
              aria-invalid={errors.user ? 'true' : undefined}
              {...register('user')}
            />
            {errors.user && (
              <p className="text-xs text-feedback-danger-fg">{errors.user.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cred-from" required>Email de envio (From)</Label>
            <p className="text-xs text-text-muted">
              Endereço que aparece como remetente nos emails enviados.
            </p>
            <Input
              id="cred-from"
              type="email"
              placeholder="no-reply@axonai.com"
              disabled={!canMutate}
              aria-invalid={errors.fromEmail ? 'true' : undefined}
              {...register('fromEmail')}
            />
            {errors.fromEmail && (
              <p className="text-xs text-feedback-danger-fg">{errors.fromEmail.message}</p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface-sunken p-4">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="cred-secure">Conexão TLS direta (secure)</Label>
              <p className="text-xs text-text-muted">
                Ative para porta 465 (SMTPS). Mantenha desativado para 587 (STARTTLS).
              </p>
            </div>
            <Switch
              id="cred-secure"
              checked={secureValue}
              onCheckedChange={(v) => setValue('secure', v, { shouldDirty: true })}
              disabled={!canMutate}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cred-password" required>Senha SMTP</Label>
            <p className="text-xs text-text-muted">
              {isRotate && existing?.hint
                ? `A senha atual termina em ${existing.hint}. Digite a nova senha para substituir.`
                : 'A senha é cifrada no Supabase Vault. Nunca volta para a interface após salvar.'}
            </p>
            <Input
              id="cred-password"
              type="password"
              autoComplete="new-password"
              placeholder={isRotate ? '••••••••' : ''}
              disabled={!canMutate}
              aria-invalid={errors.secretPlaintext ? 'true' : undefined}
              {...register('secretPlaintext')}
            />
            {errors.secretPlaintext && (
              <p className="text-xs text-feedback-danger-fg">{errors.secretPlaintext.message}</p>
            )}
          </div>

          {canMutate && (
            <div className="flex justify-start">
              <Button type="submit" disabled={isSubmitting} size="md">
                {isSubmitting
                  ? (isRotate ? 'Rotacionando…' : 'Salvando…')
                  : (isRotate ? 'Rotacionar credencial' : 'Configurar credencial')}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
