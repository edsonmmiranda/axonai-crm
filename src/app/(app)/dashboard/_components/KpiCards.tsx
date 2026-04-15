import {
  DollarSign,
  MessageCircle,
  Phone,
  TrendingDown,
  TrendingUp,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { KPI, KpiIcon } from '@/lib/mocks/dashboard';

const iconMap: Record<KpiIcon, LucideIcon> = {
  'user-plus': UserPlus,
  'dollar-sign': DollarSign,
  phone: Phone,
  'message-circle': MessageCircle,
};

const iconToneClass: Record<KPI['iconTone'], string> = {
  primary: 'text-action-primary',
  info: 'text-feedback-info-fg',
  accent: 'text-feedback-accent-fg',
  success: 'text-feedback-success-fg',
};

const badgeToneClass: Record<NonNullable<KPI['badge']>['tone'], string> = {
  success: 'bg-feedback-success-bg text-feedback-success-fg',
  primary: 'bg-action-primary/10 text-action-primary',
  neutral: 'bg-transparent text-text-secondary',
};

interface KpiCardsProps {
  kpis: KPI[];
}

export function KpiCards({ kpis }: KpiCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {kpis.map((kpi) => {
        const Icon = iconMap[kpi.icon];
        const TrendIcon =
          kpi.badge?.trend === 'up'
            ? TrendingUp
            : kpi.badge?.trend === 'down'
              ? TrendingDown
              : null;

        return (
          <article
            key={kpi.id}
            className="group relative overflow-hidden rounded-xl border border-border bg-surface-raised p-5 shadow-sm transition-all hover:border-action-primary/30"
          >
            <div
              className="pointer-events-none absolute right-0 top-0 p-4 opacity-5 transition-opacity group-hover:opacity-10"
              aria-hidden="true"
            >
              <Icon className={cn('size-16', iconToneClass[kpi.iconTone])} />
            </div>
            <div className="relative z-10 flex flex-col gap-1">
              <p className="text-sm font-medium text-text-secondary">{kpi.label}</p>
              <div className="flex items-baseline gap-2">
                <h3 className="text-3xl font-bold text-text-primary">{kpi.value}</h3>
                {kpi.badge && (
                  <span
                    className={cn(
                      'flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-bold',
                      badgeToneClass[kpi.badge.tone],
                    )}
                  >
                    {TrendIcon && <TrendIcon className="size-3.5" aria-hidden="true" />}
                    {kpi.badge.text}
                  </span>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
