'use client';

import { useTransition, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { setFeatureFlagAction } from '@/lib/actions/admin/feature-flags';
import type { FeatureFlagView } from '@/lib/actions/admin/feature-flags.schemas';

interface Props {
  flags: FeatureFlagView[];
  canMutate: boolean;
}

const REQUIRE_ADMIN_MFA_KEY = 'require_admin_mfa';

export function FeatureFlagsList({ flags, canMutate }: Props) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [confirmingDisable, setConfirmingDisable] = useState<{
    key: string;
    label: string;
  } | null>(null);

  function handleToggle(key: string, newEnabled: boolean) {
    if (!canMutate) return;

    if (key === REQUIRE_ADMIN_MFA_KEY && newEnabled === false) {
      const flag = flags.find((f) => f.key === key);
      if (flag) setConfirmingDisable({ key, label: flag.label });
      return;
    }

    applyToggle(key, newEnabled);
  }

  function applyToggle(key: string, newEnabled: boolean) {
    setOptimistic((prev) => ({ ...prev, [key]: newEnabled }));
    startTransition(async () => {
      const result = await setFeatureFlagAction({ key, enabled: newEnabled });
      if (!result.success) {
        setOptimistic((prev) => ({ ...prev, [key]: !newEnabled }));
        toast.error(result.error ?? 'Erro ao salvar flag.');
      } else {
        toast.success(`Flag "${key}" ${newEnabled ? 'ativada' : 'desativada'}.`);
      }
    });
  }

  function handleConfirmDisable() {
    if (!confirmingDisable) return;
    applyToggle(confirmingDisable.key, false);
    setConfirmingDisable(null);
  }

  if (flags.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-text-muted">Nenhuma feature flag registrada.</p>
    );
  }

  return (
    <>
      <div className="divide-y divide-border rounded-xl border border-border bg-surface-raised">
        {flags.map((flag) => {
          const enabled = flag.key in optimistic ? optimistic[flag.key] : flag.enabled;
          return (
            <div key={flag.key} className="flex items-center justify-between gap-4 p-4">
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-text-primary">{flag.label}</p>
                  {!flag.isInitialized && (
                    <Badge variant="neutral" className="text-xs">Não configurada</Badge>
                  )}
                  {flag.isPublic && (
                    <Badge variant="role-admin" className="text-xs">Pública</Badge>
                  )}
                </div>
                <p className="text-xs text-text-muted">{flag.description}</p>
                <p className="text-xs font-mono text-text-muted">{flag.key}</p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={(v) => handleToggle(flag.key, v)}
                disabled={!canMutate || pending}
                aria-label={`Toggle feature flag ${flag.key}`}
              />
            </div>
          );
        })}
      </div>

      <Dialog
        open={!!confirmingDisable}
        onOpenChange={(open) => {
          if (!open) setConfirmingDisable(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-feedback-warning-fg" aria-hidden="true" />
              Desligar MFA obrigatório para administradores?
            </DialogTitle>
            <DialogDescription>
              Esta política controla a exigência de segundo fator no acesso à área admin.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 text-sm text-text-secondary">
            <p>Ao desligar:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Admins sem fator TOTP configurado passarão a entrar com{' '}
                <strong className="text-text-primary">aal1</strong> (sem segundo fator).
              </li>
              <li>
                Admins com{' '}
                <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-xs">
                  mfa_reset_required
                </code>{' '}
                <strong className="text-text-primary">continuam</strong> sendo forçados a re-enroll
                — esta regra do Sprint 11 não é afetada.
              </li>
              <li>
                A mudança é registrada no audit log com{' '}
                <strong className="text-text-primary">IP</strong> e{' '}
                <strong className="text-text-primary">User-Agent</strong>.
              </li>
            </ul>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmingDisable(null)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleConfirmDisable}
              disabled={pending}
            >
              Sim, desligar MFA admin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
