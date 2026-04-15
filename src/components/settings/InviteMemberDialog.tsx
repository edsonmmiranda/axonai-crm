'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import { Copy, UserPlus } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createInvitationAction } from '@/lib/actions/invitations';

const InviteSchema = z.object({
  email: z.string().email('Email inválido'),
  role: z.enum(['admin', 'member']),
});

type InviteValues = z.infer<typeof InviteSchema>;

export function InviteMemberDialog() {
  const [open, setOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const urlInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteValues>({
    resolver: zodResolver(InviteSchema),
    defaultValues: { email: '', role: 'member' },
  });

  useEffect(() => {
    if (!open) {
      reset();
      setInviteUrl(null);
      setFormError(null);
    }
  }, [open, reset]);

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const res = await createInvitationAction(values);
      if (!res.success || !res.data) {
        const msg = res.error ?? 'Erro ao criar convite.';
        setFormError(msg);
        toast.error(msg);
        return;
      }
      setInviteUrl(res.data.inviteUrl);
      toast.success('Convite criado.');
    });
  });

  const handleCopy = () => {
    if (!inviteUrl) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(inviteUrl).then(
        () => toast.success('Link copiado.'),
        () => {
          urlInputRef.current?.select();
          toast.info('Copie o link manualmente.');
        }
      );
      return;
    }
    urlInputRef.current?.select();
    toast.info('Copie o link manualmente.');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">
          <UserPlus className="size-4" aria-hidden="true" />
          Convidar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar membro</DialogTitle>
          <DialogDescription>
            Gere um link de convite para adicionar alguém à sua organização.
          </DialogDescription>
        </DialogHeader>

        {inviteUrl ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-secondary">
              Copie e envie manualmente ao convidado. O link expira em 7 dias.
            </p>
            <div className="flex items-center gap-2">
              <Input
                ref={urlInputRef}
                readOnly
                value={inviteUrl}
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button type="button" variant="secondary" onClick={handleCopy}>
                <Copy className="size-4" aria-hidden="true" />
                Copiar
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Fechar
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            {formError ? (
              <div
                role="alert"
                className="rounded-md border border-feedback-danger-border bg-feedback-danger-bg px-3 py-2 text-sm text-feedback-danger-fg"
              >
                {formError}
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inviteEmail" required>
                Email
              </Label>
              <Input
                id="inviteEmail"
                type="email"
                autoComplete="email"
                aria-invalid={errors.email ? true : undefined}
                {...register('email')}
              />
              {errors.email ? (
                <p className="text-xs text-feedback-danger-fg">{errors.email.message}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inviteRole" required>
                Role
              </Label>
              <select
                id="inviteRole"
                className="h-10 rounded-md border border-field-border bg-field px-3 text-sm text-field-fg focus-visible:border-field-border-focus focus-visible:outline-none focus-visible:shadow-focus"
                {...register('role')}
              >
                <option value="member">Membro</option>
                <option value="admin">Admin</option>
              </select>
              {errors.role ? (
                <p className="text-xs text-feedback-danger-fg">{errors.role.message}</p>
              ) : null}
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Gerando…' : 'Gerar link'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
