'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Archive, Check, Gauge, Package, Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { ArchivePlanDialog } from './ArchivePlanDialog';
import { DeletePlanDialog } from './DeletePlanDialog';
import {
  archivePlanAction,
  createPlanAction,
  updatePlanAction,
} from '@/lib/actions/admin/plans';
import type { PlanListItem } from '@/lib/actions/admin/plans';

interface Props {
  mode: 'create' | 'edit';
  initialData?: PlanListItem;
}

function centsToReais(cents: number): string {
  if (cents === 0) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

function reaisToCents(value: string): number {
  const num = parseFloat(value.replace(',', '.'));
  return isNaN(num) ? 0 : Math.round(num * 100);
}

function limitToString(val: number | null | undefined): string {
  return val == null ? '' : String(val);
}

function parseLimit(val: string): number | null {
  const n = parseInt(val, 10);
  return isNaN(n) || n < 1 ? null : n;
}

const LIMIT_FIELDS = [
  { id: 'maxUsers',  label: 'Máx. usuários' },
  { id: 'maxLeads',  label: 'Máx. leads' },
  { id: 'maxProds',  label: 'Máx. produtos' },
  { id: 'maxPipes',  label: 'Máx. pipelines' },
  { id: 'maxInteg',  label: 'Máx. integrações' },
  { id: 'maxStore',  label: 'Storage (MB)' },
] as const;

export function PlanForm({ mode, initialData }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [archivePending, startArchiveTransition] = useTransition();

  const [name, setName]                 = useState(initialData?.name ?? '');
  const [description, setDescription]   = useState(initialData?.description ?? '');
  const [priceMonthly, setPriceMonthly] = useState(centsToReais(initialData?.priceMonthly ?? 0));
  const [priceYearly, setPriceYearly]   = useState(centsToReais(initialData?.priceYearly ?? 0));
  const [isPublic, setIsPublic]         = useState(initialData?.isPublic ?? true);
  const [features, setFeatures]         = useState<string[]>([]);
  const [newFeature, setNewFeature]     = useState('');

  const [maxUsers, setMaxUsers]                  = useState(limitToString(initialData?.maxUsers));
  const [maxLeads, setMaxLeads]                  = useState(limitToString(initialData?.maxLeads));
  const [maxProducts, setMaxProducts]            = useState(limitToString(initialData?.maxProducts));
  const [maxPipelines, setMaxPipelines]          = useState(limitToString(initialData?.maxPipelines));
  const [maxActiveIntegrations, setMaxActiveInt] = useState(limitToString(initialData?.maxActiveIntegrations));
  const [maxStorageMb, setMaxStorageMb]          = useState(limitToString(initialData?.maxStorageMb));
  const [allowAi, setAllowAi]                    = useState(initialData?.allowAiFeatures ?? false);

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen]   = useState(false);

  const limitState: Record<string, { value: string; set: (v: string) => void }> = {
    maxUsers:  { value: maxUsers,              set: setMaxUsers },
    maxLeads:  { value: maxLeads,              set: setMaxLeads },
    maxProds:  { value: maxProducts,           set: setMaxProducts },
    maxPipes:  { value: maxPipelines,          set: setMaxPipelines },
    maxInteg:  { value: maxActiveIntegrations, set: setMaxActiveInt },
    maxStore:  { value: maxStorageMb,          set: setMaxStorageMb },
  };

  function addFeature() {
    const trimmed = newFeature.trim();
    if (!trimmed) return;
    setFeatures((prev) => [...prev, trimmed]);
    setNewFeature('');
  }

  function removeFeature(idx: number) {
    setFeatures((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        priceMonthly: reaisToCents(priceMonthly),
        priceYearly: reaisToCents(priceYearly),
        featuresJsonb: features,
        isPublic,
        maxUsers: parseLimit(maxUsers),
        maxLeads: parseLimit(maxLeads),
        maxProducts: parseLimit(maxProducts),
        maxPipelines: parseLimit(maxPipelines),
        maxActiveIntegrations: parseLimit(maxActiveIntegrations),
        maxStorageMb: parseLimit(maxStorageMb),
        allowAiFeatures: allowAi,
      };

      if (mode === 'create') {
        const res = await createPlanAction(payload);
        if (!res.success) { toast.error(res.error ?? 'Erro ao criar plano.'); return; }
        toast.success('Plano criado com sucesso.');
        router.push('/admin/plans');
      } else {
        if (!initialData) return;
        const res = await updatePlanAction({ id: initialData.id, ...payload });
        if (!res.success) { toast.error(res.error ?? 'Erro ao salvar plano.'); return; }
        toast.success('Plano atualizado.');
        router.push('/admin/plans');
      }
    });
  }

  function handleArchive() {
    if (!initialData) return;
    startArchiveTransition(async () => {
      const res = await archivePlanAction({ id: initialData.id });
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível arquivar o plano.');
        return;
      }
      toast.success(`Plano "${initialData.name}" arquivado.`);
      setArchiveOpen(false);
      router.push('/admin/plans');
    });
  }

  const canDelete = mode === 'edit' && initialData?.activeSubscriptionsCount === 0;
  const submitLabel = isPending
    ? mode === 'create' ? 'Criando...' : 'Salvando...'
    : mode === 'create' ? 'Criar plano' : 'Salvar alterações';

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <section className="rounded-xl border border-border bg-surface-raised p-6 shadow-sm md:p-8">
          <header className="mb-6 flex items-center gap-3 border-b border-border-subtle pb-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-feedback-info-bg text-feedback-info-fg">
              <Package className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-text-primary">Informações básicas</h3>
              <p className="text-sm text-text-secondary">Identificação, preços e visibilidade do plano.</p>
            </div>
          </header>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label htmlFor="planName" required className="mb-2 block">Nome do plano</Label>
              <Input
                id="planName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Pro, Business, Enterprise"
                required
              />
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="planDesc" className="mb-2 block">Descrição</Label>
              <Textarea
                id="planDesc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Resuma o que este plano oferece para o cliente final."
                rows={3}
              />
            </div>

            <div>
              <Label htmlFor="priceMonthly" className="mb-2 block">Preço mensal</Label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <span className="text-sm text-text-secondary">R$</span>
                </div>
                <Input
                  id="priceMonthly"
                  value={priceMonthly}
                  onChange={(e) => setPriceMonthly(e.target.value)}
                  placeholder="0,00"
                  className="pl-10"
                  inputMode="decimal"
                />
              </div>
              <p className="mt-1.5 text-xs text-text-muted">Deixe vazio ou 0 para plano gratuito.</p>
            </div>

            <div>
              <Label htmlFor="priceYearly" className="mb-2 block">Preço anual</Label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <span className="text-sm text-text-secondary">R$</span>
                </div>
                <Input
                  id="priceYearly"
                  value={priceYearly}
                  onChange={(e) => setPriceYearly(e.target.value)}
                  placeholder="0,00"
                  className="pl-10"
                  inputMode="decimal"
                />
              </div>
            </div>

            <div className="md:col-span-2 flex items-center gap-3">
              <Switch id="isPublic" checked={isPublic} onCheckedChange={setIsPublic} />
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="isPublic">Visível no catálogo público</Label>
                <p className="text-xs text-text-muted">
                  Planos privados só são atribuíveis manualmente por admins.
                </p>
              </div>
            </div>

            <div className="md:col-span-2 flex flex-col gap-2">
              <Label className="block">Features exibidas ao cliente</Label>
              <div className="flex gap-2">
                <Input
                  value={newFeature}
                  onChange={(e) => setNewFeature(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addFeature(); }
                  }}
                  placeholder="Ex: Até 20 usuários inclusos"
                />
                <Button type="button" variant="secondary" onClick={addFeature} aria-label="Adicionar feature">
                  <Plus className="size-4" aria-hidden="true" />
                  Adicionar
                </Button>
              </div>
              {features.length > 0 && (
                <ul className="mt-1 flex flex-col gap-1.5">
                  {features.map((f, i) => (
                    <li
                      key={`${f}-${i}`}
                      className="flex items-center justify-between rounded-md border border-border-subtle bg-surface-sunken px-3 py-2 text-sm text-text-secondary"
                    >
                      <span>{f}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="size-8 p-0"
                        onClick={() => removeFeature(i)}
                        aria-label={`Remover feature: ${f}`}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface-raised p-6 shadow-sm md:p-8">
          <header className="mb-6 flex items-center gap-3 border-b border-border-subtle pb-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-feedback-accent-bg text-feedback-accent-fg">
              <Gauge className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-text-primary">Limites do plano</h3>
              <p className="text-sm text-text-secondary">Quotas por organização. Deixe vazio para ilimitado.</p>
            </div>
          </header>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
            {LIMIT_FIELDS.map(({ id, label }) => (
              <div key={id}>
                <Label htmlFor={id} className="mb-2 block">{label}</Label>
                <Input
                  id={id}
                  type="number"
                  min={1}
                  value={limitState[id]!.value}
                  onChange={(e) => limitState[id]!.set(e.target.value)}
                  placeholder="∞ ilimitado"
                />
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-3 border-t border-border-subtle pt-6">
            <Switch id="allowAi" checked={allowAi} onCheckedChange={setAllowAi} />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="allowAi" className="flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-feedback-accent-fg" aria-hidden="true" />
                Recursos de IA habilitados
              </Label>
              <p className="text-xs text-text-muted">
                Libera funcionalidades de inteligência artificial para organizações neste plano.
              </p>
            </div>
          </div>
        </section>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push('/admin/plans')}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={isPending}>
            <Check className="size-4" aria-hidden="true" />
            {submitLabel}
          </Button>
        </div>

        {mode === 'edit' && initialData && (
          <section className="mt-4 rounded-xl border border-feedback-danger-border bg-feedback-danger-bg p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-feedback-danger-fg" aria-hidden="true" />
              <div className="flex flex-col gap-3">
                <div>
                  <h3 className="text-base font-bold text-feedback-danger-fg">Zona de perigo</h3>
                  <p className="mt-1 text-sm text-feedback-danger-fg/90">
                    Arquivar oculta o plano do catálogo público — subscriptions ativas continuam intactas.
                    Excluir é irreversível e só é possível quando não há subscriptions ativas neste plano.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => setArchiveOpen(true)}
                    disabled={archivePending}
                  >
                    <Archive className="size-4" aria-hidden="true" />
                    Arquivar plano
                  </Button>
                  {canDelete && (
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => setDeleteOpen(true)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Excluir plano
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </form>

      {archiveOpen && initialData && (
        <ArchivePlanDialog
          open={archiveOpen}
          onClose={() => setArchiveOpen(false)}
          onConfirm={handleArchive}
          isPending={archivePending}
        />
      )}
      {deleteOpen && initialData && (
        <DeletePlanDialog
          plan={initialData}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </>
  );
}
