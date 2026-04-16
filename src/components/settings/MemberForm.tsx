'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { updateMemberAction } from '@/lib/actions/team';
import type { TeamMember } from '@/lib/actions/invitations';

const FormSchema = z.object({
  role: z.enum(['admin', 'member']),
  active: z.boolean(),
});

type FormValues = z.infer<typeof FormSchema>;

export interface MemberFormProps {
  member: TeamMember;
}

export function MemberForm({ member }: MemberFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const defaultRole: 'admin' | 'member' = member.role === 'admin' ? 'admin' : 'member';

  const {
    handleSubmit,
    control,
    formState: { isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      role: defaultRole,
      active: member.is_active,
    },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const res = await updateMemberAction({
        memberId: member.id,
        role: values.role,
        active: values.active,
      });
      if (!res.success) {
        const message = res.error ?? 'Não foi possível salvar o membro.';
        setFormError(message);
        toast.error(message);
        return;
      }
      toast.success('Membro atualizado.');
      router.push('/settings/team');
    });
  });

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

      <div className="flex flex-col gap-1.5">
        <Label>Nome</Label>
        <p className="text-sm text-text-primary">{member.full_name}</p>
        {member.email ? (
          <p className="text-xs text-text-secondary">{member.email}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="memberRole" required>
          Role
        </Label>
        <Controller
          control={control}
          name="role"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="memberRole">
                <SelectValue placeholder="Selecione a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Membro</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        <p className="text-xs text-text-secondary">
          Admins podem gerenciar convites, membros e configurações.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-md border border-border bg-surface-raised px-4 py-3">
        <div className="flex flex-col">
          <Label htmlFor="memberActive">Acesso ativo</Label>
          <p className="text-xs text-text-secondary">
            Membros inativos perdem acesso à organização até serem reativados.
          </p>
        </div>
        <Controller
          control={control}
          name="active"
          render={({ field }) => (
            <Switch
              id="memberActive"
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push('/settings/team')}
          disabled={isPending}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={isPending || !isDirty}>
          {isPending ? 'Salvando…' : 'Salvar alterações'}
        </Button>
      </div>
    </form>
  );
}
