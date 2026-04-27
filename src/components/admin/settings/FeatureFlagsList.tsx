'use client';

import { useTransition, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { setFeatureFlagAction } from '@/lib/actions/admin/feature-flags';
import type { FeatureFlagView } from '@/lib/actions/admin/feature-flags.schemas';

interface Props {
  flags: FeatureFlagView[];
  canMutate: boolean;
}

export function FeatureFlagsList({ flags, canMutate }: Props) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});

  function handleToggle(key: string, newEnabled: boolean) {
    if (!canMutate) return;
    setOptimistic((prev) => ({ ...prev, [key]: newEnabled }));
    startTransition(async () => {
      const result = await setFeatureFlagAction({ key, enabled: newEnabled });
      if (!result.success) {
        setOptimistic((prev) => ({ ...prev, [key]: !newEnabled })); // rollback
        toast.error(result.error ?? 'Erro ao salvar flag.');
      } else {
        toast.success(`Flag "${key}" ${newEnabled ? 'ativada' : 'desativada'}.`);
      }
    });
  }

  if (flags.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-text-muted">Nenhuma feature flag registrada.</p>
    );
  }

  return (
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
  );
}
