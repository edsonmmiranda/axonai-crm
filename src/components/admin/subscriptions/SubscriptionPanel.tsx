'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Calendar, Users, FileText, BarChart2, Zap, HardDrive, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SubscriptionStatusBadge } from './SubscriptionStatusBadge';
import {
  changePlanAction,
  extendTrialAction,
  cancelSubscriptionAction,
  reactivateSubscriptionAction,
  markPastDueAction,
} from '@/lib/actions/admin/subscriptions';
import type { OrgSubscriptionDetail } from '@/lib/actions/admin/subscriptions';
import type { PlatformAdminRole } from '@/lib/auth/platformAdmin';

interface AvailablePlan { id: string; name: string }

interface Props {
  orgId: string;
  orgSlug: string;
  subscription: OrgSubscriptionDetail | null;
  availablePlans: AvailablePlan[];
  adminRole: PlatformAdminRole;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

function formatLimit(val: number | null) {
  return val === null ? '∞' : val.toLocaleString('pt-BR');
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.ceil(diff / 86400000);
}

export function SubscriptionPanel({ orgId, orgSlug, subscription, availablePlans, adminRole }: Props) {
  const canMutate = adminRole === 'owner' || adminRole === 'billing';

  if (!subscription) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface-raised py-12 text-center">
        <p className="text-text-secondary text-sm">Nenhuma subscription ativa encontrada para esta organização.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <StatusCard subscription={subscription} />
      {canMutate && subscription.status === 'trial' && (
        <ExtendTrialSection orgId={orgId} subscriptionId={subscription.subscriptionId} periodEnd={subscription.periodEnd} />
      )}
      {canMutate && ['trial', 'ativa', 'past_due'].includes(subscription.status) && (
        <ChangePlanSection orgId={orgId} subscriptionId={subscription.subscriptionId} currentPlanId={subscription.planId} availablePlans={availablePlans} />
      )}
      {canMutate && subscription.status === 'ativa' && (
        <MarkPastDueSection orgId={orgId} subscriptionId={subscription.subscriptionId} />
      )}
      {canMutate && !['cancelada', 'trial_expired'].includes(subscription.status) && (
        <CancelSection orgId={orgId} orgSlug={orgSlug} subscriptionId={subscription.subscriptionId} />
      )}
      {canMutate && ['cancelada', 'trial_expired'].includes(subscription.status) && (
        <ReactivateSection orgId={orgId} subscriptionId={subscription.subscriptionId} availablePlans={availablePlans} />
      )}
    </div>
  );
}

/* ─── StatusCard ─────────────────────────────────────────────── */

function StatusCard({ subscription }: { subscription: OrgSubscriptionDetail }) {
  const daysLeft = daysUntil(subscription.periodEnd);
  const { limits } = subscription;

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-text-primary">{subscription.planName}</span>
            <SubscriptionStatusBadge status={subscription.status} />
          </div>
          <p className="text-sm text-text-muted font-mono">{subscription.subscriptionId}</p>
        </div>
        <div className="flex items-center gap-4 text-sm text-text-secondary">
          <span className="flex items-center gap-1.5"><Calendar className="size-4" /> Início: {formatDate(subscription.periodStart)}</span>
          {subscription.periodEnd && (
            <span className="flex items-center gap-1.5">
              <Calendar className="size-4" />
              {subscription.status === 'trial' ? `Trial expira: ${formatDate(subscription.periodEnd)}` : `Fim: ${formatDate(subscription.periodEnd)}`}
              {daysLeft !== null && daysLeft > 0 && (
                <span className="text-text-muted">({daysLeft}d restantes)</span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Limites */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 pt-2 border-t border-border-subtle">
        {[
          { icon: Users,     label: 'Usuários',     value: formatLimit(limits.maxUsers) },
          { icon: FileText,  label: 'Leads',        value: formatLimit(limits.maxLeads) },
          { icon: BarChart2, label: 'Produtos',      value: formatLimit(limits.maxProducts) },
          { icon: Zap,       label: 'Pipelines',    value: formatLimit(limits.maxPipelines) },
          { icon: Zap,       label: 'Integrações',  value: formatLimit(limits.maxActiveIntegrations) },
          { icon: HardDrive, label: 'Storage',      value: limits.maxStorageMb === null ? '∞' : `${limits.maxStorageMb} MB` },
          { icon: Sparkles,  label: 'IA',           value: limits.allowAiFeatures ? 'Sim' : 'Não' },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1 text-xs text-text-muted">
              <Icon className="size-3.5" />{label}
            </span>
            <span className="text-sm font-medium text-text-primary">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── ChangePlanSection ──────────────────────────────────────── */

function ChangePlanSection({ orgId, subscriptionId, currentPlanId, availablePlans }: {
  orgId: string; subscriptionId: string; currentPlanId: string; availablePlans: AvailablePlan[];
}) {
  const [selectedPlan, setSelectedPlan] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleChange() {
    if (!selectedPlan || selectedPlan === currentPlanId) return;
    startTransition(async () => {
      const res = await changePlanAction(orgId, { subscriptionId, newPlanId: selectedPlan });
      if (!res.success) { toast.error(res.error ?? 'Erro ao trocar plano.'); return; }
      toast.success('Plano alterado com sucesso.');
      setSelectedPlan('');
    });
  }

  const otherPlans = availablePlans.filter((p) => p.id !== currentPlanId);

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-6 flex flex-col gap-4">
      <h3 className="text-base font-semibold text-text-primary">Trocar plano</h3>
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5 flex-1 max-w-xs">
          <Label htmlFor="newPlanSelect">Novo plano</Label>
          <Select value={selectedPlan} onValueChange={setSelectedPlan}>
            <SelectTrigger id="newPlanSelect">
              <SelectValue placeholder="Selecione um plano..." />
            </SelectTrigger>
            <SelectContent>
              {otherPlans.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="primary" size="sm" disabled={!selectedPlan || isPending} onClick={handleChange}>
          {isPending ? 'Trocando...' : 'Trocar plano'}
        </Button>
      </div>
    </div>
  );
}

/* ─── ExtendTrialSection ─────────────────────────────────────── */

function ExtendTrialSection({ orgId, subscriptionId, periodEnd }: {
  orgId: string; subscriptionId: string; periodEnd: string | null;
}) {
  const [days, setDays] = useState('7');
  const [isPending, startTransition] = useTransition();

  function handleExtend() {
    const n = parseInt(days, 10);
    if (isNaN(n) || n < 1) { toast.error('Informe um número válido de dias (1–365).'); return; }
    startTransition(async () => {
      const res = await extendTrialAction(orgId, { subscriptionId, days: n });
      if (!res.success) { toast.error(res.error ?? 'Erro ao estender trial.'); return; }
      toast.success(`Trial estendido por ${n} dias.`);
    });
  }

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-6 flex flex-col gap-4">
      <h3 className="text-base font-semibold text-text-primary">Estender trial</h3>
      {periodEnd && (
        <p className="text-sm text-text-secondary">
          Trial atual expira em <span className="font-medium">{formatDate(periodEnd)}</span>
          {daysUntil(periodEnd) !== null && ` (${daysUntil(periodEnd)} dia(s) restantes)`}.
        </p>
      )}
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="trialDays">Dias adicionais</Label>
          <Input id="trialDays" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} className="w-28" />
        </div>
        <Button variant="primary" size="sm" disabled={isPending} onClick={handleExtend}>
          {isPending ? 'Estendendo...' : 'Estender'}
        </Button>
      </div>
    </div>
  );
}

/* ─── MarkPastDueSection ─────────────────────────────────────── */

function MarkPastDueSection({ orgId, subscriptionId }: { orgId: string; subscriptionId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const res = await markPastDueAction(orgId, { subscriptionId });
      if (!res.success) { toast.error(res.error ?? 'Erro.'); return; }
      toast.success('Subscription marcada como inadimplente.');
      setOpen(false);
    });
  }

  return (
    <>
      <div className="rounded-lg border border-border bg-surface-raised p-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-text-primary">Marcar como inadimplente</p>
          <p className="text-sm text-text-muted">Muda o status para &ldquo;past_due&rdquo; sem cancelar.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Marcar past_due</Button>
      </div>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar como inadimplente?</DialogTitle>
            <DialogDescription>O status será alterado para &ldquo;past_due&rdquo;. A subscription permanece ativa mas sinaliza pendência de pagamento.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>Cancelar</Button>
            <Button variant="danger" onClick={handleConfirm} disabled={isPending}>{isPending ? 'Salvando...' : 'Confirmar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ─── CancelSection ──────────────────────────────────────────── */

function CancelSection({ orgId, orgSlug, subscriptionId }: { orgId: string; orgSlug: string; subscriptionId: string }) {
  const [open, setOpen] = useState(false);
  const [slugConfirm, setSlugConfirm] = useState('');
  const [isPending, startTransition] = useTransition();

  const canConfirm = slugConfirm === orgSlug;

  function handleClose() { setSlugConfirm(''); setOpen(false); }

  function handleCancel() {
    if (!canConfirm) return;
    startTransition(async () => {
      const res = await cancelSubscriptionAction(orgId, { subscriptionId });
      if (!res.success) { toast.error(res.error ?? 'Erro ao cancelar.'); return; }
      toast.success('Subscription cancelada.');
      handleClose();
    });
  }

  return (
    <>
      <div className="rounded-lg border border-feedback-danger-border bg-feedback-danger-bg p-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-feedback-danger-fg">Cancelar subscription</p>
          <p className="text-sm text-feedback-danger-fg opacity-80">Encerra a vigência da subscription desta organização.</p>
        </div>
        <Button variant="danger" size="sm" onClick={() => setOpen(true)}>Cancelar subscription</Button>
      </div>
      <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar subscription</DialogTitle>
            <DialogDescription>Esta ação encerrará a subscription. Os usuários da organização perderão acesso.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5 py-2">
            <Label htmlFor="cancelSlug">
              Digite o slug <span className="font-semibold text-text-primary">{orgSlug}</span> para confirmar
            </Label>
            <Input id="cancelSlug" value={slugConfirm} onChange={(e) => setSlugConfirm(e.target.value)} placeholder={orgSlug} autoComplete="off" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={handleClose} disabled={isPending}>Cancelar</Button>
            <Button variant="danger" onClick={handleCancel} disabled={!canConfirm || isPending}>{isPending ? 'Cancelando...' : 'Confirmar cancelamento'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ─── ReactivateSection ──────────────────────────────────────── */

function ReactivateSection({ orgId, subscriptionId, availablePlans }: {
  orgId: string; subscriptionId: string; availablePlans: AvailablePlan[];
}) {
  const [selectedPlan, setSelectedPlan] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleReactivate() {
    if (!selectedPlan) return;
    startTransition(async () => {
      const res = await reactivateSubscriptionAction(orgId, { subscriptionId, newPlanId: selectedPlan });
      if (!res.success) { toast.error(res.error ?? 'Erro ao reativar.'); return; }
      toast.success('Subscription reativada.');
      setSelectedPlan('');
    });
  }

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-6 flex flex-col gap-4">
      <h3 className="text-base font-semibold text-text-primary">Reativar subscription</h3>
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5 flex-1 max-w-xs">
          <Label htmlFor="reactivatePlan">Plano para reativação</Label>
          <Select value={selectedPlan} onValueChange={setSelectedPlan}>
            <SelectTrigger id="reactivatePlan">
              <SelectValue placeholder="Selecione um plano..." />
            </SelectTrigger>
            <SelectContent>
              {availablePlans.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="primary" size="sm" disabled={!selectedPlan || isPending} onClick={handleReactivate}>
          {isPending ? 'Reativando...' : 'Reativar'}
        </Button>
      </div>
    </div>
  );
}
