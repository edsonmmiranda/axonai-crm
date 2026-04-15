import { Flag, Rocket } from 'lucide-react';

import type { MonthlyGoal, SalesGoal } from '@/lib/mocks/dashboard';

interface GoalsRowProps {
  salesGoal: SalesGoal;
  monthlyGoal: MonthlyGoal;
}

export function GoalsRow({ salesGoal, monthlyGoal }: GoalsRowProps) {
  const progressStyle = { width: `${monthlyGoal.progressPercent}%` };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <article className="relative flex min-h-40 flex-col justify-between overflow-hidden rounded-xl bg-gradient-to-br from-action-primary-hover to-action-primary-active p-6 text-text-inverse shadow-lg">
        <div
          className="absolute -right-10 -top-10 size-32 rounded-full bg-surface-raised/10 blur-3xl"
          aria-hidden="true"
        />
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Rocket className="size-5" aria-hidden="true" />
            <span className="text-sm font-bold uppercase tracking-wide opacity-90">
              {salesGoal.tag}
            </span>
          </div>
          <h4 className="pr-8 text-xl font-bold">{salesGoal.title}</h4>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex -space-x-2" aria-label={`${salesGoal.collaboratorsCount + salesGoal.extraCount} colaboradores`}>
            {Array.from({ length: salesGoal.collaboratorsCount }).map((_, index) => (
              <div
                key={index}
                className="size-8 rounded-full border border-surface-raised/30 bg-surface-raised/20 backdrop-blur-sm"
                aria-hidden="true"
              />
            ))}
            <div className="flex size-8 items-center justify-center rounded-full border border-surface-raised/30 bg-surface-raised/20 text-xs font-bold backdrop-blur-sm">
              +{salesGoal.extraCount}
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg bg-surface-raised px-4 py-2 text-sm font-bold text-action-primary shadow-lg transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:shadow-focus"
          >
            {salesGoal.ctaLabel}
          </button>
        </div>
      </article>

      <article className="flex flex-col justify-between rounded-xl border border-border bg-surface-raised p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-text-secondary">{monthlyGoal.label}</p>
            <h4 className="mt-1 text-2xl font-bold text-text-primary">{monthlyGoal.progressLabel}</h4>
          </div>
          <div className="rounded-lg bg-feedback-success-bg p-2">
            <Flag className="size-5 text-feedback-success-fg" aria-hidden="true" />
          </div>
        </div>
        <div
          className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-valuenow={monthlyGoal.progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={monthlyGoal.label}
        >
          <div className="h-full rounded-full bg-action-primary" style={progressStyle} />
        </div>
        <p className="mt-2 text-xs text-text-secondary">{monthlyGoal.helperText}</p>
      </article>
    </div>
  );
}
