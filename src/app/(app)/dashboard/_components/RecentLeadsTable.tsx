import Link from 'next/link';
import {
  ArrowRight,
  Globe,
  MessageCircle,
  MoreVertical,
  Phone,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type {
  AvatarTone,
  Lead,
  LeadSource,
  LeadStatusTone,
} from '@/lib/mocks/dashboard';

const avatarToneClass: Record<AvatarTone, string> = {
  info: 'bg-feedback-info-bg text-feedback-info-fg',
  accent: 'bg-feedback-accent-bg text-feedback-accent-fg',
  danger: 'bg-feedback-danger-bg text-feedback-danger-fg',
  warning: 'bg-feedback-warning-bg text-feedback-warning-fg',
  success: 'bg-feedback-success-bg text-feedback-success-fg',
};

const statusToneClass: Record<LeadStatusTone, string> = {
  info: 'bg-feedback-info-bg text-feedback-info-fg border-feedback-info-border',
  warning: 'bg-feedback-warning-bg text-feedback-warning-fg border-feedback-warning-border',
  accent: 'bg-feedback-accent-bg text-feedback-accent-fg border-feedback-accent-border',
};

interface SourceMeta {
  label: string;
  icon: LucideIcon;
  variant: 'success' | 'neutral';
}

const sourceMeta: Record<LeadSource, SourceMeta> = {
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, variant: 'success' },
  website: { label: 'Website', icon: Globe, variant: 'neutral' },
  indicacao: { label: 'Indicação', icon: Phone, variant: 'neutral' },
};

const sourceVariantClass: Record<SourceMeta['variant'], string> = {
  success: 'bg-feedback-success-bg text-feedback-success-fg border-feedback-success-border',
  neutral: 'bg-surface-sunken text-text-secondary border-border',
};

interface RecentLeadsTableProps {
  leads: Lead[];
}

export function RecentLeadsTable({ leads }: RecentLeadsTableProps) {
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-sm">
      <header className="flex items-center justify-between border-b border-border-subtle bg-surface-sunken/50 p-5">
        <h3 className="text-lg font-bold text-text-primary">Leads Recentes</h3>
        <Link
          href="#"
          className="flex items-center gap-1 text-sm font-medium text-text-link hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          Ver todos <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border-subtle bg-surface-sunken text-xs uppercase text-text-secondary">
            <tr>
              <th scope="col" className="px-6 py-3 font-semibold">Nome</th>
              <th scope="col" className="px-6 py-3 font-semibold">Interesse</th>
              <th scope="col" className="px-6 py-3 font-semibold">Origem</th>
              <th scope="col" className="px-6 py-3 font-semibold">Status</th>
              <th scope="col" className="px-6 py-3 text-right font-semibold">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {leads.map((lead) => {
              const source = sourceMeta[lead.source];
              const SourceIcon = source.icon;
              return (
                <tr key={lead.id} className="group transition-colors hover:bg-surface-sunken/80">
                  <td className="px-6 py-4 font-medium text-text-primary">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'flex size-8 items-center justify-center rounded-full text-xs font-bold',
                          avatarToneClass[lead.avatarTone],
                        )}
                        aria-hidden="true"
                      >
                        {lead.initials}
                      </div>
                      {lead.name}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-text-secondary">{lead.interest}</td>
                  <td className="px-6 py-4">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium',
                        sourceVariantClass[source.variant],
                      )}
                    >
                      <SourceIcon className="size-3.5" aria-hidden="true" />
                      {source.label}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={cn(
                        'rounded-full border px-2 py-1 text-xs font-medium',
                        statusToneClass[lead.statusTone],
                      )}
                    >
                      {lead.statusLabel}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      type="button"
                      aria-label={`Mais ações para ${lead.name}`}
                      className="rounded p-1 text-text-muted transition-colors hover:bg-action-ghost-hover/50 hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
                    >
                      <MoreVertical className="size-5" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
