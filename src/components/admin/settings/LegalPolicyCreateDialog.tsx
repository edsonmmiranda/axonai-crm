'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { FilePlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createLegalPolicyAction } from '@/lib/actions/admin/legal-policies';
import { LEGAL_POLICY_KINDS } from '@/lib/actions/admin/legal-policies.schemas';
import type { LegalPolicyKind } from '@/lib/actions/admin/legal-policies.schemas';

const schema = z.object({
  kindConfirmation: z.string(),
  effectiveAt: z.string().min(1, 'Informe a data de vigência.'),
  contentMd: z.string().min(50, 'Conteúdo muito curto (mín. 50 chars).').max(200_000),
  summary: z.string().min(10, 'Resumo muito curto (mín. 10 chars).').max(500),
});

const KIND_LABELS: Record<LegalPolicyKind, string> = {
  terms: 'Termos de Uso',
  privacy: 'Política de Privacidade',
  dpa: 'DPA',
  cookies: 'Política de Cookies',
};

interface Props {
  kind: LegalPolicyKind;
  onCreated?: () => void;
}

export function LegalPolicyCreateDialog({ kind, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      kindConfirmation: '',
      effectiveAt: new Date().toISOString().slice(0, 16),
      contentMd: '',
      summary: '',
    },
  });

  const kindConfirmation = watch('kindConfirmation');
  const isConfirmed = kindConfirmation === kind;

  function onSubmit(values: z.infer<typeof schema>) {
    startTransition(async () => {
      const result = await createLegalPolicyAction({
        kind,
        effectiveAt: new Date(values.effectiveAt),
        contentMd: values.contentMd,
        summary: values.summary,
      });
      if (result.success) {
        toast.success(`Nova versão criada para ${KIND_LABELS[kind]}.`);
        reset();
        setOpen(false);
        onCreated?.();
      } else {
        toast.error(result.error ?? 'Erro ao criar versão.');
      }
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <FilePlus className="size-4" />
        Nova versão
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova versão — {KIND_LABELS[kind]}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`effectiveAt-${kind}`}>Data de vigência</Label>
              <Input id={`effectiveAt-${kind}`} type="datetime-local" {...register('effectiveAt')} />
              {errors.effectiveAt && <p className="text-xs text-feedback-danger-fg">{errors.effectiveAt.message}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`summary-${kind}`}>Resumo das alterações</Label>
              <Input id={`summary-${kind}`} placeholder="Ex: Atualização dos termos de responsabilidade (LGPD 2026)" {...register('summary')} />
              {errors.summary && <p className="text-xs text-feedback-danger-fg">{errors.summary.message}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`contentMd-${kind}`}>Conteúdo (Markdown)</Label>
              <Textarea
                id={`contentMd-${kind}`}
                rows={12}
                placeholder="# Termos de Uso&#10;&#10;..."
                {...register('contentMd')}
                className="font-mono text-xs"
              />
              {errors.contentMd && <p className="text-xs text-feedback-danger-fg">{errors.contentMd.message}</p>}
            </div>

            {/* Confirmação de segurança — digitar o kind */}
            <div className="rounded-lg border border-feedback-warning-border bg-feedback-warning-bg p-3 flex flex-col gap-2">
              <p className="text-xs text-feedback-warning-fg">
                Esta ação é irreversível. Digite{' '}
                <code className="rounded bg-surface-sunken px-1 font-mono font-bold">{kind}</code>{' '}
                para confirmar.
              </p>
              <Input
                placeholder={kind}
                {...register('kindConfirmation')}
                className="max-w-[200px]"
              />
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" size="md" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!isConfirmed || isSubmitting} size="md">
                {isSubmitting ? 'Criando…' : 'Criar nova versão'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
