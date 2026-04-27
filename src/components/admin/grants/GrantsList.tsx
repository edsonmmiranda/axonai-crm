'use client';

import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { GrantCreateDialog } from './GrantCreateDialog';
import { GrantRevokeDialog } from './GrantRevokeDialog';
import { GrantStatusBadge } from './GrantStatusBadge';
import type { GrantListItem } from '@/lib/actions/admin/grants';
import type { LimitKey } from '@/lib/actions/admin/grants';

const LIMIT_LABELS: Record<LimitKey, string> = {
  users:               'Usuários',
  leads:               'Leads',
  products:            'Produtos',
  pipelines:           'Pipelines',
  active_integrations: 'Integrações ativas',
  storage_mb:          'Armazenamento (MB)',
};

const numberFormatter = new Intl.NumberFormat('pt-BR');

interface Props {
  organizationId: string;
  items: GrantListItem[];
  canMutate: boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatValue(value: number | null): string {
  if (value === null) return 'Ilimitado';
  return numberFormatter.format(value);
}

export function GrantsList({ organizationId, items, canMutate }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const includeRevoked = searchParams.get('includeRevoked') === '1';
  const includeExpired = searchParams.get('includeExpired') === '1';

  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<GrantListItem | null>(null);

  function setQueryParam(key: 'includeRevoked' | 'includeExpired', value: boolean) {
    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, '1');
      else params.delete(key);
      router.replace(`?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="includeRevoked"
              checked={includeRevoked}
              onCheckedChange={(v) => setQueryParam('includeRevoked', v)}
            />
            <Label htmlFor="includeRevoked">Mostrar revogados</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="includeExpired"
              checked={includeExpired}
              onCheckedChange={(v) => setQueryParam('includeExpired', v)}
            />
            <Label htmlFor="includeExpired">Mostrar expirados</Label>
          </div>
        </div>
        {canMutate && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Conceder grant
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-raised p-10 text-center">
          <p className="text-sm text-text-muted">
            Nenhum grant para esta organização.
          </p>
          {canMutate && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-4"
              onClick={() => setCreateOpen(true)}
            >
              Conceder primeiro grant
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface-raised shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-sunken">
              <tr className="text-text-secondary">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Tipo</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Override</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Razão</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Expira em</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Criado por</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((g) => (
                <tr key={g.id} className="border-b border-border-subtle last:border-b-0">
                  <td className="px-4 py-3 font-medium text-text-primary">{LIMIT_LABELS[g.limitKey]}</td>
                  <td className="px-4 py-3 text-text-primary">{formatValue(g.valueOverride)}</td>
                  <td className="px-4 py-3 text-text-secondary max-w-md truncate">{g.reason}</td>
                  <td className="px-4 py-3 text-text-secondary">{formatDate(g.expiresAt)}</td>
                  <td className="px-4 py-3 text-text-secondary">{g.createdByName ?? '—'}</td>
                  <td className="px-4 py-3"><GrantStatusBadge status={g.status} /></td>
                  <td className="px-4 py-3 text-right">
                    {canMutate && g.status === 'active' ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRevokeTarget(g)}
                      >
                        Revogar
                      </Button>
                    ) : (
                      <span className="text-xs text-text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <GrantCreateDialog
        organizationId={organizationId}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
      <GrantRevokeDialog
        grant={revokeTarget}
        open={revokeTarget !== null}
        onOpenChange={(o) => { if (!o) setRevokeTarget(null); }}
      />
    </div>
  );
}
