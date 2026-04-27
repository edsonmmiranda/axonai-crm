'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { createGrantAction } from '@/lib/actions/admin/grants';
import type { LimitKey } from '@/lib/actions/admin/grants';

const LIMIT_OPTIONS: { value: LimitKey; label: string }[] = [
  { value: 'users',               label: 'Usuários' },
  { value: 'leads',               label: 'Leads' },
  { value: 'products',            label: 'Produtos' },
  { value: 'pipelines',           label: 'Pipelines' },
  { value: 'active_integrations', label: 'Integrações ativas' },
  { value: 'storage_mb',          label: 'Armazenamento (MB)' },
];

interface Props {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GrantCreateDialog({ organizationId, open, onOpenChange }: Props) {
  const router = useRouter();
  const [limitKey, setLimitKey]           = useState<LimitKey>('leads');
  const [unlimited, setUnlimited]         = useState(false);
  const [valueOverride, setValueOverride] = useState('');
  const [reason, setReason]               = useState('');
  const [expiresAt, setExpiresAt]         = useState('');
  const [isPending, startTransition]      = useTransition();

  useEffect(() => {
    if (!open) {
      setLimitKey('leads');
      setUnlimited(false);
      setValueOverride('');
      setReason('');
      setExpiresAt('');
    }
  }, [open]);

  const valueOverrideValid =
    unlimited || (valueOverride.trim().length > 0 && Number.isInteger(Number(valueOverride)) && Number(valueOverride) >= 0);
  const reasonValid = reason.trim().length >= 5 && reason.trim().length <= 500;
  const canSubmit = valueOverrideValid && reasonValid && !isPending;

  function handleConfirm() {
    if (!canSubmit) return;
    startTransition(async () => {
      const r = await createGrantAction({
        organizationId,
        limitKey,
        valueOverride: unlimited ? null : Number(valueOverride),
        reason: reason.trim(),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      if (!r.success) {
        toast.error(r.error ?? 'Não foi possível criar o grant.');
        return;
      }
      toast.success('Grant criado com sucesso.');
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Conceder grant de limite</DialogTitle>
          <DialogDescription>
            Sobrescreve o limite do plano vigente para esta organização. Toda alteração é registrada em audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="limitKey" required>Tipo de limite</Label>
            <Select value={limitKey} onValueChange={(v) => setLimitKey(v as LimitKey)}>
              <SelectTrigger id="limitKey">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIMIT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-surface-sunken px-3 py-2">
            <Label htmlFor="unlimited" className="font-medium">Ilimitado</Label>
            <Switch id="unlimited" checked={unlimited} onCheckedChange={setUnlimited} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="valueOverride" required={!unlimited}>Valor de override</Label>
            <Input
              id="valueOverride"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={unlimited ? '' : valueOverride}
              onChange={(e) => setValueOverride(e.target.value)}
              disabled={unlimited}
              placeholder={unlimited ? 'Ilimitado' : 'Ex: 5000'}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reason" required>Razão (5–500 caracteres)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Descreva o motivo do grant (será visível no audit log)..."
              rows={3}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="expiresAt">Expira em (opcional)</Label>
            <Input
              id="expiresAt"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
            <span className="text-xs text-text-muted">
              Deixe em branco para grant sem expiração. Após expirar, o limite do plano volta a valer.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!canSubmit}>
            {isPending ? 'Criando...' : 'Conceder grant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
