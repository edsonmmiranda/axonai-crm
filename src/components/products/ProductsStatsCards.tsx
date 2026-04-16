import { Archive, AlertTriangle, CheckCircle2, Package } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { ProductStats } from '@/lib/actions/products';

interface StatCardConfig {
  key: keyof ProductStats;
  label: string;
  icon: LucideIcon;
  iconClassName: string;
}

const STAT_CARDS: readonly StatCardConfig[] = [
  {
    key: 'total',
    label: 'Total de produtos',
    icon: Package,
    iconClassName: 'text-action-primary',
  },
  {
    key: 'active',
    label: 'Ativos',
    icon: CheckCircle2,
    iconClassName: 'text-feedback-success-fg',
  },
  {
    key: 'archived',
    label: 'Arquivados',
    icon: Archive,
    iconClassName: 'text-text-muted',
  },
  {
    key: 'noStock',
    label: 'Sem estoque',
    icon: AlertTriangle,
    iconClassName: 'text-feedback-warning-fg',
  },
] as const;

interface ProductsStatsCardsProps {
  stats: ProductStats;
}

export function ProductsStatsCards({ stats }: ProductsStatsCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {STAT_CARDS.map((card) => {
        const Icon = card.icon;
        const value = stats[card.key];
        return (
          <div
            key={card.key}
            className="group relative overflow-hidden rounded-xl border border-border bg-surface-raised p-5 shadow-sm transition-all hover:border-action-primary/30"
          >
            <div className="pointer-events-none absolute right-0 top-0 p-4 opacity-5 transition-opacity group-hover:opacity-10">
              <Icon className={`size-16 ${card.iconClassName}`} aria-hidden="true" />
            </div>
            <div className="relative z-10 flex flex-col gap-1">
              <p className="text-sm font-medium text-text-secondary">{card.label}</p>
              <h3 className="text-3xl font-bold text-text-primary">
                {value.toLocaleString('pt-BR')}
              </h3>
            </div>
          </div>
        );
      })}
    </div>
  );
}
