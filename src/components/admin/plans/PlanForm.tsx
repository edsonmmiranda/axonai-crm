'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { createPlanAction, updatePlanAction } from '@/lib/actions/admin/plans';
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

export function PlanForm({ mode, initialData }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName]               = useState(initialData?.name ?? '');
  const [description, setDescription] = useState(initialData?.description ?? '');
  const [priceMonthly, setPriceMonthly] = useState(centsToReais(initialData?.priceMonthly ?? 0));
  const [priceYearly, setPriceYearly]   = useState(centsToReais(initialData?.priceYearly ?? 0));
  const [isPublic, setIsPublic]         = useState(initialData?.isPublic ?? true);
  const [features, setFeatures]         = useState<string[]>(initialData ? [] : []);
  const [newFeature, setNewFeature]     = useState('');

  const [maxUsers, setMaxUsers]                   = useState(limitToString(initialData?.maxUsers));
  const [maxLeads, setMaxLeads]                   = useState(limitToString(initialData?.maxLeads));
  const [maxProducts, setMaxProducts]             = useState(limitToString(initialData?.maxProducts));
  const [maxPipelines, setMaxPipelines]           = useState(limitToString(initialData?.maxPipelines));
  const [maxActiveIntegrations, setMaxActiveInt]  = useState(limitToString(initialData?.maxActiveIntegrations));
  const [maxStorageMb, setMaxStorageMb]           = useState(limitToString(initialData?.maxStorageMb));
  const [allowAi, setAllowAi]                     = useState(initialData?.allowAiFeatures ?? false);

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

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8 max-w-2xl">
      {/* Informações básicas */}
      <section className="rounded-lg border border-border bg-surface-raised p-6 flex flex-col gap-5">
        <h3 className="text-base font-semibold text-text-primary">Informações básicas</h3>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="planName" required>Nome do plano</Label>
          <Input id="planName" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Pro, Business, Enterprise" required />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="planDesc">Descrição</Label>
          <Textarea id="planDesc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descreva o plano brevemente..." rows={3} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="priceMonthly">Preço mensal (R$)</Label>
            <Input id="priceMonthly" value={priceMonthly} onChange={(e) => setPriceMonthly(e.target.value)} placeholder="0,00" />
            <p className="text-xs text-text-muted">Deixe em branco ou 0 para plano gratuito</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="priceYearly">Preço anual (R$)</Label>
            <Input id="priceYearly" value={priceYearly} onChange={(e) => setPriceYearly(e.target.value)} placeholder="0,00" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Switch id="isPublic" checked={isPublic} onCheckedChange={setIsPublic} />
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="isPublic">Visível no catálogo público</Label>
            <p className="text-xs text-text-muted">Planos privados só são atribuíveis por admins</p>
          </div>
        </div>

        {/* Features */}
        <div className="flex flex-col gap-2">
          <Label>Features exibidas ao cliente</Label>
          <div className="flex gap-2">
            <Input value={newFeature} onChange={(e) => setNewFeature(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFeature())} placeholder="Ex: Até 20 usuários" />
            <Button type="button" variant="secondary" size="sm" onClick={addFeature}>
              <Plus className="size-4" />
            </Button>
          </div>
          {features.length > 0 && (
            <ul className="flex flex-col gap-1 mt-1">
              {features.map((f, i) => (
                <li key={i} className="flex items-center justify-between rounded border border-border-subtle bg-surface-sunken px-3 py-2 text-sm text-text-secondary">
                  {f}
                  <Button type="button" variant="ghost" size="sm" className="size-8 p-0" onClick={() => removeFeature(i)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Limites */}
      <section className="rounded-lg border border-border bg-surface-raised p-6 flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-text-primary">Limites do plano</h3>
          <p className="text-sm text-text-muted">Deixe em branco para ilimitado (∞)</p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[
            { id: 'maxUsers',  label: 'Máx. usuários',     value: maxUsers,              onChange: setMaxUsers },
            { id: 'maxLeads',  label: 'Máx. leads',        value: maxLeads,              onChange: setMaxLeads },
            { id: 'maxProds',  label: 'Máx. produtos',     value: maxProducts,           onChange: setMaxProducts },
            { id: 'maxPipes',  label: 'Máx. pipelines',    value: maxPipelines,          onChange: setMaxPipelines },
            { id: 'maxInteg',  label: 'Máx. integrações',  value: maxActiveIntegrations, onChange: setMaxActiveInt },
            { id: 'maxStore',  label: 'Storage (MB)',       value: maxStorageMb,          onChange: setMaxStorageMb },
          ].map(({ id, label, value, onChange }) => (
            <div key={id} className="flex flex-col gap-1.5">
              <Label htmlFor={id}>{label}</Label>
              <Input id={id} type="number" min={1} value={value} onChange={(e) => onChange(e.target.value)} placeholder="∞ ilimitado" />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Switch id="allowAi" checked={allowAi} onCheckedChange={setAllowAi} />
          <Label htmlFor="allowAi">Recursos de IA habilitados</Label>
        </div>
      </section>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? (mode === 'create' ? 'Criando...' : 'Salvando...') : (mode === 'create' ? 'Criar plano' : 'Salvar alterações')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push('/admin/plans')} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
