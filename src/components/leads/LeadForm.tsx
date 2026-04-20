'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import { AlertTriangle, PowerOff, RotateCcw, Trash2, User, Globe, Briefcase, FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LeadTagsSelect } from './LeadTagsSelect';
import { DeactivateLeadDialog } from './DeactivateLeadDialog';
import { RestoreLeadDialog } from './RestoreLeadDialog';
import { DeleteLeadDialog } from './DeleteLeadDialog';
import {
  createLeadAction,
  updateLeadAction,
  type CreateLeadInput,
  type LeadRow,
  type OriginOption,
  type ProfileOption,
  type TagOption,
  type LeadStatus,
} from '@/lib/actions/leads';

const LEAD_STATUS_VALUES = [
  'new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost',
] as const;

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'Novo',
  contacted: 'Contactado',
  qualified: 'Qualificado',
  proposal: 'Proposta',
  negotiation: 'Negociação',
  won: 'Ganho',
  lost: 'Perdido',
};

const FormSchema = z.object({
  name: z.string().trim().min(2, 'Nome deve ter ao menos 2 caracteres').max(100, 'Nome deve ter no máximo 100 caracteres'),
  email: z.string().trim().transform((v) => (v === '' ? undefined : v)).pipe(z.string().email('Email inválido').optional()),
  phone: z.string().trim().transform((v) => (v === '' ? undefined : v)).pipe(z.string().min(8, 'Telefone deve ter ao menos 8 caracteres').max(20, 'Telefone deve ter no máximo 20 caracteres').optional()),
  company: z.string().trim().transform((v) => (v === '' ? undefined : v)).pipe(z.string().max(100, 'Empresa deve ter no máximo 100 caracteres').optional()),
  position: z.string().trim().transform((v) => (v === '' ? undefined : v)).pipe(z.string().max(100, 'Cargo deve ter no máximo 100 caracteres').optional()),
  notes: z.string().trim().transform((v) => (v === '' ? undefined : v)).pipe(z.string().max(2000, 'Notas devem ter no máximo 2000 caracteres').optional()),
  status: z.enum(LEAD_STATUS_VALUES).optional().default('new'),
  score: z.coerce.number().int().min(0, 'Score mínimo é 0').max(100, 'Score máximo é 100').optional().default(0),
  value: z.coerce.number().min(0, 'Valor deve ser positivo').optional().default(0),
  medium: z.string().trim().transform((v) => (v === '' ? undefined : v)).pipe(z.string().max(100).optional()),
  campaign: z.string().trim().transform((v) => (v === '' ? undefined : v)).pipe(z.string().max(100).optional()),
  utm_source: z.string().trim().transform((v) => (v === '' ? undefined : v)).pipe(z.string().max(200).optional()),
  utm_medium: z.string().trim().transform((v) => (v === '' ? undefined : v)).pipe(z.string().max(200).optional()),
  utm_campaign: z.string().trim().transform((v) => (v === '' ? undefined : v)).pipe(z.string().max(200).optional()),
  utm_content: z.string().trim().transform((v) => (v === '' ? undefined : v)).pipe(z.string().max(200).optional()),
  utm_term: z.string().trim().transform((v) => (v === '' ? undefined : v)).pipe(z.string().max(200).optional()),
  origin_id: z.string().trim().transform((v) => (v === '' ? undefined : v)).pipe(z.string().uuid().optional()),
  assigned_to: z.string().trim().transform((v) => (v === '' ? undefined : v)).pipe(z.string().uuid().optional()),
  tagIds: z.array(z.string().uuid()).optional().default([]),
});

type FormValues = z.infer<typeof FormSchema>;

const selectClasses =
  'block w-full rounded-lg border border-field-border bg-field py-2 pl-3 pr-8 text-sm text-field-fg transition-all hover:border-field-border-hover focus-visible:border-field-border-focus focus-visible:outline-none focus-visible:shadow-focus';

export interface LeadFormProps {
  mode: 'create' | 'edit';
  lead?: LeadRow;
  origins: OriginOption[];
  profiles: ProfileOption[];
  tags: TagOption[];
  isAdmin?: boolean;
}

export function LeadForm({ mode, lead, origins, profiles, tags, isAdmin = false }: LeadFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: lead?.name ?? '',
      email: lead?.email ?? '',
      phone: lead?.phone ?? '',
      company: lead?.company ?? '',
      position: lead?.position ?? '',
      notes: lead?.notes ?? '',
      status: (lead?.status as LeadStatus) ?? 'new',
      score: lead?.score ?? 0,
      value: lead?.value ?? 0,
      medium: lead?.medium ?? '',
      campaign: lead?.campaign ?? '',
      utm_source: lead?.utm_source ?? '',
      utm_medium: lead?.utm_medium ?? '',
      utm_campaign: lead?.utm_campaign ?? '',
      utm_content: lead?.utm_content ?? '',
      utm_term: lead?.utm_term ?? '',
      origin_id: lead?.origin_id ?? '',
      assigned_to: lead?.assigned_to ?? '',
      tagIds: lead?.tags.map((t) => t.id) ?? [],
    },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      // Cast to input type — server action re-validates with its own schema
      const payload = values as unknown as CreateLeadInput;
      const res =
        mode === 'create'
          ? await createLeadAction(payload)
          : await updateLeadAction(lead!.id, payload);

      if (!res.success) {
        const message = res.error ?? 'Não foi possível salvar o lead.';
        if (message.toLowerCase().includes('nome') || message.toLowerCase().includes('name')) {
          setError('name', { message });
        } else if (message.toLowerCase().includes('email')) {
          setError('email', { message });
        } else {
          setFormError(message);
        }
        toast.error(message);
        return;
      }

      toast.success(mode === 'create' ? 'Lead criado.' : 'Lead atualizado.');
      router.push('/leads');
    });
  });

  return (
    <>
      <form id="lead-form" onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
        {formError ? (
          <div
            role="alert"
            className="rounded-md border border-feedback-danger-border bg-feedback-danger-bg px-4 py-3 text-sm text-feedback-danger-fg"
          >
            {formError}
          </div>
        ) : null}

        <Tabs defaultValue="basic">
          <TabsList>
            <TabsTrigger value="basic">
              <User className="mr-1.5 size-4" aria-hidden="true" />
              Dados Básicos
            </TabsTrigger>
            <TabsTrigger value="utm">
              <Globe className="mr-1.5 size-4" aria-hidden="true" />
              UTM / Origem
            </TabsTrigger>
            <TabsTrigger value="commercial">
              <Briefcase className="mr-1.5 size-4" aria-hidden="true" />
              Comercial
            </TabsTrigger>
            <TabsTrigger value="notes">
              <FileText className="mr-1.5 size-4" aria-hidden="true" />
              Notas
            </TabsTrigger>
          </TabsList>

          {/* Tab: Dados Básicos */}
          <TabsContent value="basic">
            <div className="rounded-xl border border-border bg-surface-raised p-6 shadow-sm md:p-8">
              <div className="mb-6 flex items-center gap-3 border-b border-border-subtle pb-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-feedback-info-bg text-feedback-info-fg">
                  <User className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-text-primary">Dados Básicos</h3>
                  <p className="text-sm text-text-secondary">
                    Informações de contato e identificação do lead.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="leadName" required>
                    Nome
                  </Label>
                  <Input
                    id="leadName"
                    aria-invalid={errors.name ? true : undefined}
                    placeholder="Nome completo"
                    {...register('name')}
                  />
                  {errors.name ? (
                    <p className="text-xs text-feedback-danger-fg">{errors.name.message}</p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="leadEmail">Email</Label>
                  <Input
                    id="leadEmail"
                    type="email"
                    aria-invalid={errors.email ? true : undefined}
                    placeholder="email@exemplo.com"
                    {...register('email')}
                  />
                  {errors.email ? (
                    <p className="text-xs text-feedback-danger-fg">{errors.email.message}</p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="leadPhone">Telefone</Label>
                  <Input
                    id="leadPhone"
                    type="tel"
                    aria-invalid={errors.phone ? true : undefined}
                    placeholder="(11) 99999-9999"
                    {...register('phone')}
                  />
                  {errors.phone ? (
                    <p className="text-xs text-feedback-danger-fg">{errors.phone.message}</p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="leadCompany">Empresa</Label>
                  <Input
                    id="leadCompany"
                    aria-invalid={errors.company ? true : undefined}
                    placeholder="Nome da empresa"
                    {...register('company')}
                  />
                  {errors.company ? (
                    <p className="text-xs text-feedback-danger-fg">{errors.company.message}</p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="leadPosition">Cargo</Label>
                  <Input
                    id="leadPosition"
                    aria-invalid={errors.position ? true : undefined}
                    placeholder="Cargo do contato"
                    {...register('position')}
                  />
                  {errors.position ? (
                    <p className="text-xs text-feedback-danger-fg">{errors.position.message}</p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="leadOrigin">Origem</Label>
                  <select
                    id="leadOrigin"
                    className={selectClasses}
                    {...register('origin_id')}
                  >
                    <option value="">Selecione uma origem...</option>
                    {origins.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <Label>Tags</Label>
                  <Controller
                    control={control}
                    name="tagIds"
                    render={({ field }) => (
                      <LeadTagsSelect
                        tags={tags}
                        selectedIds={field.value}
                        onChange={field.onChange}
                      />
                    )}
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Tab: UTM / Origem */}
          <TabsContent value="utm">
            <div className="rounded-xl border border-border bg-surface-raised p-6 shadow-sm md:p-8">
              <div className="mb-6 flex items-center gap-3 border-b border-border-subtle pb-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-feedback-info-bg text-feedback-info-fg">
                  <Globe className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-text-primary">UTM / Origem</h3>
                  <p className="text-sm text-text-secondary">
                    Parâmetros de rastreamento e campanha.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="leadMedium">Medium</Label>
                  <Input id="leadMedium" placeholder="Ex.: cpc, organic" {...register('medium')} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="leadCampaign">Campaign</Label>
                  <Input id="leadCampaign" placeholder="Nome da campanha" {...register('campaign')} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="leadUtmSource">UTM Source</Label>
                  <Input id="leadUtmSource" placeholder="Ex.: google, facebook" {...register('utm_source')} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="leadUtmMedium">UTM Medium</Label>
                  <Input id="leadUtmMedium" placeholder="Ex.: cpc, email" {...register('utm_medium')} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="leadUtmCampaign">UTM Campaign</Label>
                  <Input id="leadUtmCampaign" placeholder="Nome da campanha UTM" {...register('utm_campaign')} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="leadUtmContent">UTM Content</Label>
                  <Input id="leadUtmContent" placeholder="Conteúdo do anúncio" {...register('utm_content')} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="leadUtmTerm">UTM Term</Label>
                  <Input id="leadUtmTerm" placeholder="Termo de busca" {...register('utm_term')} />
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Tab: Comercial */}
          <TabsContent value="commercial">
            <div className="rounded-xl border border-border bg-surface-raised p-6 shadow-sm md:p-8">
              <div className="mb-6 flex items-center gap-3 border-b border-border-subtle pb-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-feedback-info-bg text-feedback-info-fg">
                  <Briefcase className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-text-primary">Comercial</h3>
                  <p className="text-sm text-text-secondary">
                    Status, valor e responsável pelo lead.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="leadStatus">Status</Label>
                  <select
                    id="leadStatus"
                    className={selectClasses}
                    {...register('status')}
                  >
                    {LEAD_STATUS_VALUES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="leadAssigned">Responsável</Label>
                  <select
                    id="leadAssigned"
                    className={selectClasses}
                    {...register('assigned_to')}
                  >
                    <option value="">Sem responsável</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="leadScore">Score (0-100)</Label>
                  <Input
                    id="leadScore"
                    type="number"
                    min={0}
                    max={100}
                    aria-invalid={errors.score ? true : undefined}
                    {...register('score')}
                  />
                  {errors.score ? (
                    <p className="text-xs text-feedback-danger-fg">{errors.score.message}</p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="leadValue">Valor (R$)</Label>
                  <Input
                    id="leadValue"
                    type="number"
                    min={0}
                    step="0.01"
                    aria-invalid={errors.value ? true : undefined}
                    {...register('value')}
                  />
                  {errors.value ? (
                    <p className="text-xs text-feedback-danger-fg">{errors.value.message}</p>
                  ) : null}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Tab: Notas */}
          <TabsContent value="notes">
            <div className="rounded-xl border border-border bg-surface-raised p-6 shadow-sm md:p-8">
              <div className="mb-6 flex items-center gap-3 border-b border-border-subtle pb-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-feedback-info-bg text-feedback-info-fg">
                  <FileText className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-text-primary">Notas</h3>
                  <p className="text-sm text-text-secondary">
                    Observações e anotações sobre o lead.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="leadNotes">Observações</Label>
                <Textarea
                  id="leadNotes"
                  aria-invalid={errors.notes ? true : undefined}
                  placeholder="Anotações sobre o lead..."
                  rows={8}
                  {...register('notes')}
                />
                {errors.notes ? (
                  <p className="text-xs text-feedback-danger-fg">{errors.notes.message}</p>
                ) : null}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Action Bar */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push('/leads')}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending || (mode === 'edit' && !isDirty)}>
            {isPending
              ? 'Salvando...'
              : mode === 'create'
                ? 'Criar lead'
                : 'Salvar alterações'}
          </Button>
        </div>
      </form>

      {/* Danger Zone — edit only, admin only */}
      {mode === 'edit' && lead && isAdmin ? (
        <div className="rounded-xl border border-feedback-danger-border bg-feedback-danger-bg p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-lg bg-feedback-danger-solid-bg text-feedback-danger-solid-fg">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-text-primary">Zona de Perigo</h3>
              <p className="mt-1 text-sm text-text-secondary">
                {lead.is_active
                  ? 'Inativar oculta o lead das listagens. Excluir o remove permanentemente.'
                  : 'Este lead está inativo. Reative-o ou exclua permanentemente.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                {lead.is_active ? (
                  <Button type="button" variant="secondary" onClick={() => setShowDeactivateDialog(true)}>
                    <PowerOff className="size-4" aria-hidden="true" />
                    Inativar lead
                  </Button>
                ) : (
                  <Button type="button" variant="secondary" onClick={() => setShowRestoreDialog(true)}>
                    <RotateCcw className="size-4" aria-hidden="true" />
                    Reativar lead
                  </Button>
                )}
                <Button type="button" variant="danger" onClick={() => setShowDeleteDialog(true)}>
                  <Trash2 className="size-4" aria-hidden="true" />
                  Excluir lead
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showDeactivateDialog && lead ? (
        <DeactivateLeadDialog
          leadId={lead.id}
          leadName={lead.name}
          onClose={() => setShowDeactivateDialog(false)}
          redirectAfter
        />
      ) : null}

      {showRestoreDialog && lead ? (
        <RestoreLeadDialog
          leadId={lead.id}
          leadName={lead.name}
          onClose={() => setShowRestoreDialog(false)}
        />
      ) : null}

      {showDeleteDialog && lead ? (
        <DeleteLeadDialog
          leadId={lead.id}
          leadName={lead.name}
          onClose={() => setShowDeleteDialog(false)}
          redirectAfter
        />
      ) : null}
    </>
  );
}
