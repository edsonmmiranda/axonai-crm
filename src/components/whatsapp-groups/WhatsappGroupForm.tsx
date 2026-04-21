'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import { AlertTriangle, MessageCircle, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  createWhatsappGroupAction,
  updateWhatsappGroupAction,
  deleteWhatsappGroupAction,
  type WhatsappGroupRow,
} from '@/lib/actions/whatsapp-groups';

const FormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Nome deve ter ao menos 2 caracteres')
    .max(100, 'Nome deve ter no máximo 100 caracteres'),
  description: z
    .string()
    .trim()
    .max(500, 'Descrição deve ter no máximo 500 caracteres')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  whatsapp_id: z
    .string()
    .trim()
    .max(100, 'ID do grupo deve ter no máximo 100 caracteres')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  is_active: z.boolean(),
});

type FormValues = z.infer<typeof FormSchema>;

export interface WhatsappGroupFormProps {
  mode: 'create' | 'edit';
  group?: WhatsappGroupRow;
  isAdmin?: boolean;
}

export function WhatsappGroupForm({ mode, group, isAdmin = false }: WhatsappGroupFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, startDeleteTransition] = useTransition();

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: group?.name ?? '',
      description: group?.description ?? '',
      whatsapp_id: group?.whatsapp_id ?? '',
      is_active: group?.is_active ?? true,
    },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const payload = {
        name: values.name,
        description: values.description || undefined,
        whatsapp_id: values.whatsapp_id || undefined,
        is_active: values.is_active,
      };

      const res =
        mode === 'create'
          ? await createWhatsappGroupAction(payload)
          : await updateWhatsappGroupAction(group!.id, payload);

      if (!res.success) {
        const message = res.error ?? 'Não foi possível salvar o grupo.';
        if (message.toLowerCase().includes('nome')) {
          setError('name', { message });
        } else {
          setFormError(message);
        }
        toast.error(message);
        return;
      }

      toast.success(mode === 'create' ? 'Grupo criado.' : 'Grupo atualizado.');
      router.push('/whatsapp-groups');
    });
  });

  function handleDelete() {
    startDeleteTransition(async () => {
      const res = await deleteWhatsappGroupAction(group!.id);
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível excluir o grupo.');
        setShowDeleteDialog(false);
        return;
      }
      toast.success('Grupo excluído.');
      router.push('/whatsapp-groups');
    });
  }

  return (
    <>
      <form id="whatsapp-group-form" onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
        {formError ? (
          <div
            role="alert"
            className="rounded-md border border-feedback-danger-border bg-feedback-danger-bg px-4 py-3 text-sm text-feedback-danger-fg"
          >
            {formError}
          </div>
        ) : null}

        {/* Form Card Section */}
        <div className="rounded-xl border border-border bg-surface-raised p-6 shadow-sm md:p-8">
          <div className="mb-6 flex items-center gap-3 border-b border-border-subtle pb-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-feedback-success-bg text-feedback-success-fg">
              <MessageCircle className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-text-primary">Informações do Grupo</h3>
              <p className="text-sm text-text-secondary">
                Dados de identificação do grupo de WhatsApp.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="groupName" required>
                Nome
              </Label>
              <Input
                id="groupName"
                aria-invalid={errors.name ? true : undefined}
                placeholder="Ex.: Grupo Clientes VIP"
                {...register('name')}
              />
              {errors.name ? (
                <p className="text-xs text-feedback-danger-fg">{errors.name.message}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="groupDescription">Descrição</Label>
              <Textarea
                id="groupDescription"
                aria-invalid={errors.description ? true : undefined}
                placeholder="Ex.: Grupo para comunicação com clientes do plano premium."
                rows={3}
                {...register('description')}
              />
              <p className="text-xs text-text-secondary">
                Opcional. Descreva o propósito deste grupo.
              </p>
              {errors.description ? (
                <p className="text-xs text-feedback-danger-fg">{errors.description.message}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="groupWhatsappId">ID do Grupo no WhatsApp</Label>
              <Input
                id="groupWhatsappId"
                aria-invalid={errors.whatsapp_id ? true : undefined}
                placeholder="Ex.: 120363012345678901@g.us"
                {...register('whatsapp_id')}
              />
              <p className="text-xs text-text-secondary">
                Opcional. ID do grupo na plataforma WhatsApp.
              </p>
              {errors.whatsapp_id ? (
                <p className="text-xs text-feedback-danger-fg">{errors.whatsapp_id.message}</p>
              ) : null}
            </div>

            {mode === 'edit' && isAdmin ? (
              <div className="flex items-center justify-between rounded-md border border-border bg-surface-sunken px-4 py-3">
                <div className="flex flex-col">
                  <Label htmlFor="groupActive">Grupo ativo</Label>
                  <p className="text-xs text-text-secondary">
                    Grupos inativos ficam ocultos na listagem padrão.
                  </p>
                </div>
                <Controller
                  control={control}
                  name="is_active"
                  render={({ field }) => (
                    <Switch
                      id="groupActive"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </div>
            ) : null}
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push('/whatsapp-groups')}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending || (mode === 'edit' && !isDirty)}>
            {isPending
              ? 'Salvando...'
              : mode === 'create'
                ? 'Criar grupo'
                : 'Salvar alterações'}
          </Button>
        </div>
      </form>

      {/* Danger Zone — edit only */}
      {mode === 'edit' && group ? (
        <div className="rounded-xl border border-feedback-danger-border bg-feedback-danger-bg p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-lg bg-feedback-danger-solid-bg text-feedback-danger-solid-fg">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-text-primary">Zona de Perigo</h3>
              <p className="mt-1 text-sm text-text-secondary">
                Excluir este grupo o remove permanentemente do sistema. Esta ação não pode ser
                desfeita.
              </p>
              <div className="mt-4">
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => {
                    setConfirmText('');
                    setShowDeleteDialog(true);
                  }}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Excluir grupo
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog ? (
        <Dialog open onOpenChange={(open) => !open && setShowDeleteDialog(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Excluir grupo</DialogTitle>
              <DialogDescription>
                Esta ação não pode ser desfeita. O grupo{' '}
                <span className="font-semibold text-text-primary">{group?.name}</span> será
                excluído permanentemente.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1.5 py-2">
              <Label htmlFor="confirmDeleteGroup">
                Digite <span className="font-semibold">excluir</span> para confirmar
              </Label>
              <Input
                id="confirmDeleteGroup"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="excluir"
                autoComplete="off"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowDeleteDialog(false)}
                disabled={isDeleting}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={handleDelete}
                disabled={confirmText !== 'excluir' || isDeleting}
              >
                {isDeleting ? 'Excluindo...' : 'Excluir grupo'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
