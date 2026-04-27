import { Users, ListTodo, Package, Layers, Plug, HardDrive } from 'lucide-react';

import type { LimitKey } from '@/lib/actions/admin/grants';

const LIMIT_LABELS: Record<LimitKey, { label: string; Icon: typeof Users; suffix: string }> = {
  users:                { label: 'Usuários',          Icon: Users,    suffix: '' },
  leads:                { label: 'Leads',             Icon: ListTodo, suffix: '' },
  products:             { label: 'Produtos',          Icon: Package,  suffix: '' },
  pipelines:            { label: 'Pipelines',         Icon: Layers,   suffix: '' },
  active_integrations:  { label: 'Integrações ativas', Icon: Plug,     suffix: '' },
  storage_mb:           { label: 'Armazenamento',     Icon: HardDrive, suffix: ' MB' },
};

const numberFormatter = new Intl.NumberFormat('pt-BR');

export interface SummaryItem {
  limitKey: LimitKey;
  planLimit: number | null;
  grantOverride: number | null;
  hasActiveGrant: boolean;
}

interface Props {
  items: SummaryItem[];
}

function formatLimit(value: number | null, suffix: string): string {
  if (value === null) return 'Ilimitado';
  return `${numberFormatter.format(value)}${suffix}`;
}

export function GrantsSummaryCards({ items }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const cfg = LIMIT_LABELS[item.limitKey];
        const Icon = cfg.Icon;
        const effective = item.hasActiveGrant ? item.grantOverride : item.planLimit;
        const overridden = item.hasActiveGrant;

        return (
          <div
            key={item.limitKey}
            className="rounded-xl border border-border bg-surface-raised p-4 shadow-sm"
          >
            <div className="mb-3 flex items-center gap-2 text-text-secondary">
              <Icon className="size-4" />
              <span className="text-xs font-medium uppercase tracking-wide">{cfg.label}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold text-text-primary">
                {formatLimit(effective, cfg.suffix)}
              </p>
              {overridden && (
                <span className="text-xs font-medium text-feedback-info-fg">override</span>
              )}
            </div>
            {overridden && (
              <p className="mt-1 text-xs text-text-muted">
                Plano: {formatLimit(item.planLimit, cfg.suffix)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
