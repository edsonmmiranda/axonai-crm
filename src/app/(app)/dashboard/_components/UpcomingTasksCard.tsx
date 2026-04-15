import { Clock, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { Task, TaskPriority } from '@/lib/mocks/dashboard';

const priorityToneClass: Record<TaskPriority, string> = {
  high: 'bg-feedback-danger-solid-bg',
  medium: 'bg-feedback-warning-solid-bg',
  low: 'bg-feedback-info-solid-bg',
};

const priorityLabel: Record<TaskPriority, string> = {
  high: 'Alta prioridade',
  medium: 'Média prioridade',
  low: 'Baixa prioridade',
};

interface UpcomingTasksCardProps {
  tasks: Task[];
}

export function UpcomingTasksCard({ tasks }: UpcomingTasksCardProps) {
  return (
    <section className="flex flex-1 flex-col rounded-xl border border-border bg-surface-raised shadow-sm">
      <header className="flex items-center justify-between border-b border-border-subtle bg-surface-sunken/50 p-5">
        <h3 className="text-lg font-bold text-text-primary">Próximas Tarefas</h3>
        <button
          type="button"
          aria-label="Adicionar tarefa"
          className="rounded p-1 text-action-ghost-fg transition-colors hover:bg-action-primary/10 focus-visible:outline-none focus-visible:shadow-focus"
        >
          <Plus className="size-5" aria-hidden="true" />
        </button>
      </header>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {tasks.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:shadow-focus"
            >
              <span
                className={cn(
                  'mt-1 size-2 shrink-0 rounded-full shadow-sm',
                  priorityToneClass[task.priority],
                )}
                aria-label={priorityLabel[task.priority]}
              />
              <span className="flex-1">
                <span className="line-clamp-1 block text-sm font-medium text-text-primary">
                  {task.title}
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-text-secondary">
                  <Clock className="size-3" aria-hidden="true" />
                  {task.scheduleLabel}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-auto border-t border-border-subtle p-4">
        <button
          type="button"
          className="w-full rounded-lg border border-border py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary focus-visible:outline-none focus-visible:shadow-focus"
        >
          Ver Todas as Tarefas
        </button>
      </div>
    </section>
  );
}
