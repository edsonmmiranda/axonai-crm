import type { ReactNode } from 'react';

interface KpiCardProps {
  label: string;
  value: number;
  icon: ReactNode;
  description?: string;
  loading?: boolean;
}

export function KpiCard({ label, value, icon, description, loading }: KpiCardProps) {
  if (loading) {
    return (
      <div className="bg-surface-raised rounded-xl p-5 border border-border shadow-sm animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken mb-3" />
        <div className="h-8 w-16 rounded bg-surface-sunken" />
      </div>
    );
  }

  return (
    <div
      className="bg-surface-raised rounded-xl p-5 border border-border shadow-sm hover:border-action-primary/30 transition-all relative overflow-hidden group"
      title={description}
    >
      <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
        <span className="size-16 text-action-primary flex items-center justify-center">{icon}</span>
      </div>
      <div className="flex flex-col gap-1 relative z-10">
        <p className="text-text-secondary text-sm font-medium">{label}</p>
        <h3 className="text-3xl font-bold text-text-primary tabular-nums">
          {value.toLocaleString('pt-BR')}
        </h3>
        {description && (
          <p className="text-text-muted text-xs mt-0.5">{description}</p>
        )}
      </div>
    </div>
  );
}
