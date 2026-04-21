'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { cn } from '@/lib/utils';
import type { PipelineLead } from '@/lib/actions/leads';

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface KanbanCardProps {
  lead: PipelineLead;
  stageId: string;
}

export function KanbanCard({ lead, stageId }: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: lead.id,
    data: { type: 'lead', leadId: lead.id, stageId },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      aria-label={`Lead ${lead.name}`}
      className={cn(
        'group relative flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-3 shadow-sm transition-shadow',
        'cursor-grab touch-none select-none active:cursor-grabbing',
        'hover:border-action-primary/50 hover:shadow-md',
        'focus-visible:outline-none focus-visible:shadow-focus',
        isDragging && 'opacity-40',
      )}
    >
      <div className="flex flex-wrap items-center gap-1">
        {lead.tags.slice(0, 3).map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center rounded-md bg-surface-sunken px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-text-secondary"
          >
            {tag.name}
          </span>
        ))}
        {lead.tags.length > 3 && (
          <span className="text-xs font-medium text-text-muted">
            +{lead.tags.length - 3}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-bold leading-snug text-text-primary">
          {lead.name}
        </h3>
      </div>

      <div className="flex items-center justify-between border-t border-border-subtle pt-2">
        <div className="flex items-center gap-2">
          {lead.assigned_to ? (
            <span
              className="flex size-6 items-center justify-center rounded-full bg-surface-sunken text-xs font-bold text-text-secondary ring-2 ring-surface-raised"
              title={lead.assigned_to.full_name}
              aria-label={`Responsável: ${lead.assigned_to.full_name}`}
            >
              {initialsOf(lead.assigned_to.full_name)}
            </span>
          ) : (
            <span
              className="flex size-6 items-center justify-center rounded-full bg-surface-sunken text-xs font-bold text-text-muted ring-2 ring-surface-raised"
              aria-label="Sem responsável"
            >
              —
            </span>
          )}
          <span className="text-sm font-bold text-text-primary">
            {lead.value > 0 ? formatCurrency(lead.value) : '—'}
          </span>
        </div>
      </div>
    </article>
  );
}
