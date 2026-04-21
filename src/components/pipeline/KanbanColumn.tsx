'use client';

import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

import { cn } from '@/lib/utils';
import type { PipelineStage } from '@/lib/actions/leads';

import { KanbanCard } from './KanbanCard';

function formatCompactCurrency(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${Math.round(value / 1_000)}k`;
  return `R$ ${value.toLocaleString('pt-BR')}`;
}

interface KanbanColumnProps {
  stage: PipelineStage;
  isDragActive: boolean;
}

export function KanbanColumn({ stage, isDragActive }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${stage.id}`,
    data: { type: 'column', stageId: stage.id },
  });

  const totalValue = stage.leads.reduce((sum, l) => sum + (l.value ?? 0), 0);
  const role = stage.stage_role;

  const containerClass = cn(
    'flex h-full w-80 shrink-0 flex-col rounded-xl border',
    role === 'won'
      ? 'border-feedback-success-border/50 bg-feedback-success-bg/20'
      : role === 'lost'
        ? 'border-feedback-danger-border/40 bg-feedback-danger-bg/15'
        : 'border-transparent bg-surface-sunken/50',
    isOver && isDragActive && 'ring-2 ring-border-focus ring-offset-0',
  );

  const countBadgeClass = cn(
    'rounded-full px-2 py-0.5 text-xs font-bold',
    role === 'won'
      ? 'bg-feedback-success-bg text-feedback-success-fg'
      : role === 'lost'
        ? 'bg-feedback-danger-bg text-feedback-danger-fg'
        : 'bg-surface-sunken text-text-secondary',
  );

  const totalClass = cn(
    'text-xs font-semibold',
    role === 'won'
      ? 'text-feedback-success-fg'
      : role === 'lost'
        ? 'text-feedback-danger-fg'
        : 'text-text-muted',
  );

  const titleClass = cn(
    'text-sm font-bold uppercase tracking-wide',
    role === 'won'
      ? 'text-feedback-success-fg'
      : role === 'lost'
        ? 'text-feedback-danger-fg'
        : 'text-text-primary',
  );

  return (
    <section
      className={containerClass}
      aria-label={`Estágio ${stage.name}, ${stage.leads_total} leads`}
    >
      <header className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className={titleClass}>{stage.name}</h2>
          <span className={countBadgeClass}>{stage.leads_total}</span>
        </div>
        {totalValue > 0 && (
          <span className={totalClass}>{formatCompactCurrency(totalValue)}</span>
        )}
      </header>

      <div
        ref={setNodeRef}
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3"
      >
        <SortableContext
          items={stage.leads.map((l) => l.id)}
          strategy={verticalListSortingStrategy}
        >
          {stage.leads.length === 0 ? (
            <div
              className={cn(
                'flex flex-1 items-center justify-center rounded-lg border border-dashed border-border px-3 py-8 text-center',
                isOver && isDragActive && 'border-action-primary/60 bg-action-primary/5',
              )}
            >
              <p className="text-xs text-text-muted">
                {isOver && isDragActive ? 'Solte aqui' : 'Nenhum lead neste estágio'}
              </p>
            </div>
          ) : (
            stage.leads.map((lead) => (
              <KanbanCard key={lead.id} lead={lead} stageId={stage.id} />
            ))
          )}
        </SortableContext>
      </div>

      {stage.leads.length < stage.leads_total && (
        <div className="border-t border-border-subtle px-4 py-2 text-center">
          <span className="text-xs text-text-muted">
            Mostrando {stage.leads.length} de {stage.leads_total}
          </span>
        </div>
      )}
    </section>
  );
}
