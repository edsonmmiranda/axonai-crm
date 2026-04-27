'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updatePlatformSettingAction } from '@/lib/actions/admin/platform-settings';

const schema = z.object({
  trialDefaultDays: z.number().int().min(1, 'Mínimo 1 dia.').max(365, 'Máximo 365 dias.'),
  pastDueGraceDays: z.number().int().min(0, 'Mínimo 0 dias.').max(90, 'Máximo 90 dias.'),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  trialDefaultDays: number;
  pastDueGraceDays: number;
  canMutate: boolean;
}

export function TrialSettingsForm({ trialDefaultDays, pastDueGraceDays, canMutate }: Props) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { trialDefaultDays, pastDueGraceDays },
  });

  async function onSubmit(values: FormValues) {
    const updates: Promise<unknown>[] = [];
    if (values.trialDefaultDays !== trialDefaultDays) {
      updates.push(updatePlatformSettingAction({ key: 'trial_default_days', valueType: 'int', value: values.trialDefaultDays }));
    }
    if (values.pastDueGraceDays !== pastDueGraceDays) {
      updates.push(updatePlatformSettingAction({ key: 'past_due_grace_days', valueType: 'int', value: values.pastDueGraceDays }));
    }
    if (updates.length === 0) { toast.info('Nenhuma alteração detectada.'); return; }
    const results = await Promise.all(updates) as { success: boolean; error?: string }[];
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) { toast.error(failed[0].error ?? 'Erro ao salvar.'); }
    else { toast.success('Configurações salvas.'); }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
      <div className="rounded-xl border border-border bg-surface-raised p-6 flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="trialDefaultDays">Duração default do trial (dias)</Label>
          <p className="text-xs text-text-muted">Aplicado a novas orgs sem override de plano ou subscription.</p>
          <Input
            id="trialDefaultDays"
            type="number"
            min={1}
            max={365}
            disabled={!canMutate}
            {...register('trialDefaultDays', { valueAsNumber: true })}
            className="max-w-[160px]"
          />
          {errors.trialDefaultDays && (
            <p className="text-xs text-feedback-danger-fg">{errors.trialDefaultDays.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pastDueGraceDays">Grace period de pagamento em atraso (dias)</Label>
          <p className="text-xs text-text-muted">Dias que a org mantém acesso após entrar em status &quot;past_due&quot; antes de ser bloqueada.</p>
          <Input
            id="pastDueGraceDays"
            type="number"
            min={0}
            max={90}
            disabled={!canMutate}
            {...register('pastDueGraceDays', { valueAsNumber: true })}
            className="max-w-[160px]"
          />
          {errors.pastDueGraceDays && (
            <p className="text-xs text-feedback-danger-fg">{errors.pastDueGraceDays.message}</p>
          )}
        </div>
      </div>

      {canMutate && (
        <div className="flex justify-start">
          <Button type="submit" disabled={isSubmitting} size="md">
            {isSubmitting ? 'Salvando…' : 'Salvar configurações'}
          </Button>
        </div>
      )}
    </form>
  );
}
