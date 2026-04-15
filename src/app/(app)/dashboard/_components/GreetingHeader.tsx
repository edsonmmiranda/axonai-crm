import { CircleCheck, FileText, UserPlus, type LucideIcon } from 'lucide-react';

interface QuickAction {
  id: string;
  label: string;
  icon: LucideIcon;
}

const quickActions: QuickAction[] = [
  { id: 'new-lead', label: 'Lead', icon: UserPlus },
  { id: 'new-proposal', label: 'Proposta', icon: FileText },
  { id: 'new-task', label: 'Nova Tarefa', icon: CircleCheck },
];

interface GreetingHeaderProps {
  greeting: string;
  dateLabel: string;
}

export function GreetingHeader({ greeting, dateLabel }: GreetingHeaderProps) {
  return (
    <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-text-primary">{greeting}</h2>
        <p className="mt-1 text-text-secondary">
          Aqui está o resumo das suas atividades de hoje,{' '}
          <span className="font-medium text-action-ghost-fg">{dateLabel}</span>.
        </p>
      </div>
      <div className="flex gap-2">
        {quickActions.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-label={label}
            className="group flex size-18 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-surface-raised shadow-sm transition-all hover:border-action-primary/50 hover:bg-action-primary/5 hover:shadow-md focus-visible:outline-none focus-visible:shadow-focus"
          >
            <Icon
              className="size-5 text-action-primary transition-transform group-hover:scale-110"
              aria-hidden="true"
            />
            <span className="text-center text-xs font-medium leading-none text-text-secondary group-hover:text-action-ghost-fg">
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
