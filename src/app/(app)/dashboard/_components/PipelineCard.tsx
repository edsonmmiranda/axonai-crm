import { cn } from '@/lib/utils';
import type { PipelineStage, PipelineTone } from '@/lib/mocks/dashboard';

const toneClass: Record<PipelineTone, string> = {
  info: 'bg-feedback-info-solid-bg',
  warning: 'bg-feedback-warning-solid-bg',
  accent: 'bg-feedback-accent-solid-bg',
  success: 'bg-feedback-success-solid-bg',
};

interface PipelineCardProps {
  stages: PipelineStage[];
}

export function PipelineCard({ stages }: PipelineCardProps) {
  return (
    <section className="rounded-xl border border-border bg-surface-raised p-5 shadow-sm">
      <h3 className="mb-4 text-lg font-bold text-text-primary">Pipeline de Vendas</h3>
      <div className="flex flex-col gap-4">
        {stages.map((stage) => {
          const style = { width: `${stage.progressPercent}%` };
          return (
            <div key={stage.id} className="group">
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-text-secondary transition-colors group-hover:text-action-ghost-fg">
                  {stage.name}
                </span>
                <span className="font-medium text-text-primary">{stage.count}</span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
                role="progressbar"
                aria-valuenow={stage.progressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${stage.name}: ${stage.count} oportunidades`}
              >
                <div className={cn('h-full rounded-full', toneClass[stage.tone])} style={style} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
