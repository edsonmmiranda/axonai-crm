'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FormProvider, useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import { AlertTriangle, GitBranch, Layers, Trash2 } from 'lucide-react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  createFunnelAction,
  updateFunnelAction,
  deleteFunnelAction,
  type FunnelWithStages,
} from '@/lib/actions/funnels';
import { updateFunnelStagesAction, type StageUpsertInput } from '@/lib/actions/funnel-stages';
import { FunnelStagesEditor } from './FunnelStagesEditor';

const StageSchema = z.object({
  id: z.string().uuid().optional(),
  name: z
    .string()
    .trim()
    .min(2, 'Nome do estágio deve ter ao menos 2 caracteres')
    .max(100, 'Nome do estágio deve ter no máximo 100 caracteres'),
  order_index: z.number().int().min(0),
});

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
  is_active: z.boolean(),
  stages: z
    .array(StageSchema)
    .min(1, 'O funil deve ter ao menos 1 estágio'),
});

type FormValues = z.infer<typeof FormSchema>;

export interface FunnelFormProps {
  mode: 'create' | 'edit';
  funnel?: FunnelWithStages;
}

export function FunnelForm({ mode, funnel }: FunnelFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, startDeleteTransition] = useTransition();

  const methods = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: funnel?.name ?? '',
      description: funnel?.description ?? '',
      is_active: funnel?.is_active ?? true,
      stages:
        funnel?.stages && funnel.stages.length > 0
          ? funnel.stages.map((s) => ({
              id: s.id,
              name: s.name,
              order_index: s.order_index,
            }))
          : [{ name: '', order_index: 0 }],
    },
  });

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isDirty },
  } = methods;

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      // Normalize order_index before saving
      const normalizedStages: StageUpsertInput[] = values.stages.map((s, i) => ({
        id: s.id,
        name: s.name,
        order_index: i,
      }));

      if (mode === 'create') {
        const res = await createFunnelAction({
          name: values.name,
          description: values.description,
          is_active: values.is_active,
          stages: normalizedStages,
        });

        if (!res.success) {
          setFormError(res.error ?? 'Não foi possível criar o funil.');
          toast.error(res.error ?? 'Não foi possível criar o funil.');
          return;
        }
        toast.success('Funil criado.');
        router.push('/funnels');
      } else {
        // Edit mode: update funnel fields then stages separately
        const funnelRes = await updateFunnelAction(funnel!.id, {
          name: values.name,
          description: values.description,
          is_active: values.is_active,
        });

        if (!funnelRes.success) {
          setFormError(funnelRes.error ?? 'Não foi possível atualizar o funil.');
          toast.error(funnelRes.error ?? 'Não foi possível atualizar o funil.');
          return;
        }

        const stagesRes = await updateFunnelStagesAction(funnel!.id, normalizedStages);

        if (!stagesRes.success) {
          setFormError(stagesRes.error ?? 'Não foi possível salvar os estágios.');
          toast.error(stagesRes.error ?? 'Não foi possível salvar os estágios.');
          return;
        }

        toast.success('Funil atualizado.');
        router.push('/funnels');
      }
    });
  });

  function handleDelete() {
    startDeleteTransition(async () => {
      const res = await deleteFunnelAction(funnel!.id);
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível excluir o funil.');
        setShowDeleteDialog(false);
        return;
      }
      toast.success('Funil excluído.');
      router.push('/funnels');
    });
  }

  return (
    <>
      <FormProvider {...methods}>
        <form id="funnel-form" onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
          {formError ? (
            <div
              role="alert"
              className="rounded-md border border-feedback-danger-border bg-feedback-danger-bg px-4 py-3 text-sm text-feedback-danger-fg"
            >
              {formError}
            </div>
          ) : null}

          {/* Card: Informações do Funil */}
          <div className="rounded-xl border border-border bg-surface-raised p-6 shadow-sm md:p-8">
            <div className="mb-6 flex items-center gap-3 border-b border-border-subtle pb-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-feedback-info-bg text-feedback-info-fg">
                <GitBranch className="size-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-text-primary">Informações do Funil</h3>
                <p className="text-sm text-text-secondary">
                  Dados de identificação do funil de vendas.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="funnelName" required>
                  Nome
                </Label>
                <Input
                  id="funnelName"
                  aria-invalid={errors.name ? true : undefined}
                  placeholder="Ex.: Vendas B2B"
                  {...register('name')}
                />
                {errors.name ? (
                  <p className="text-xs text-feedback-danger-fg">{errors.name.message}</p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="funnelDescription">Descrição</Label>
                <Textarea
                  id="funnelDescription"
                  placeholder="Descreva o propósito deste funil de vendas..."
                  rows={3}
                  aria-invalid={errors.description ? true : undefined}
                  {...register('description')}
                />
                <p className="text-xs text-text-secondary">Opcional. Até 500 caracteres.</p>
                {errors.description ? (
                  <p className="text-xs text-feedback-danger-fg">
                    {errors.description.message}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="funnelStatus" required>
                  Situação
                </Label>
                <Controller
                  control={control}
                  name="is_active"
                  render={({ field }) => (
                    <Select
                      value={field.value ? 'active' : 'inactive'}
                      onValueChange={(val) => field.onChange(val === 'active')}
                    >
                      <SelectTrigger id="funnelStatus">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Ativo</SelectItem>
                        <SelectItem value="inactive">Inativo</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="text-xs text-text-secondary">
                  Funis inativos ficam ocultos na listagem padrão.
                </p>
              </div>
            </div>
          </div>

          {/* Card: Estágios do Funil */}
          <div className="rounded-xl border border-border bg-surface-raised p-6 shadow-sm md:p-8">
            <div className="mb-6 flex items-center gap-3 border-b border-border-subtle pb-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-feedback-accent-bg text-feedback-accent-fg">
                <Layers className="size-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-text-primary">Estágios do Funil</h3>
                <p className="text-sm text-text-secondary">
                  Configure as etapas pelas quais os leads progridem neste funil.
                </p>
              </div>
            </div>

            <FunnelStagesEditor />
          </div>

          {/* Action Bar */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push('/funnels')}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || (mode === 'edit' && !isDirty)}>
              {isPending
                ? 'Salvando...'
                : mode === 'create'
                  ? 'Criar funil'
                  : 'Salvar alterações'}
            </Button>
          </div>
        </form>
      </FormProvider>

      {/* Danger Zone — edit only */}
      {mode === 'edit' && funnel ? (
        <div className="rounded-xl border border-feedback-danger-border bg-feedback-danger-bg p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-lg bg-feedback-danger-solid-bg text-feedback-danger-solid-fg">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-text-primary">Zona de Perigo</h3>
              <p className="mt-1 text-sm text-text-secondary">
                Excluir este funil remove permanentemente o funil e todos os seus estágios. Leads
                que já estejam vinculados a estágios deste funil perderão a associação.
              </p>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmText('');
                    setShowDeleteDialog(true);
                  }}
                  className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-action-danger px-4 text-sm font-bold text-action-danger-fg shadow-sm transition-colors hover:bg-action-danger-hover focus-visible:outline-none focus-visible:shadow-focus"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Excluir funil
                </button>
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
              <DialogTitle>Excluir funil</DialogTitle>
              <DialogDescription>
                Esta ação não pode ser desfeita. O funil{' '}
                <span className="font-semibold text-text-primary">{funnel?.name}</span> e todos os
                seus estágios serão excluídos permanentemente.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5 py-2">
              <Label htmlFor="confirmDeleteFunnelForm">
                Digite <span className="font-semibold">excluir</span> para confirmar
              </Label>
              <Input
                id="confirmDeleteFunnelForm"
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
              <button
                type="button"
                onClick={handleDelete}
                disabled={confirmText !== 'excluir' || isDeleting}
                className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-action-danger px-4 text-sm font-bold text-action-danger-fg shadow-sm transition-colors hover:bg-action-danger-hover focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDeleting ? 'Excluindo...' : 'Excluir funil'}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
