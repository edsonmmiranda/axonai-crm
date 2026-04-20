'use client';

import { Label } from '@/components/ui/label';
import type { OriginOption, ProfileOption, TagOption, LeadStatus } from '@/lib/actions/leads';
import { STATUS_LABELS } from './LeadStatusBadge';

const LEAD_STATUS_OPTIONS: LeadStatus[] = [
  'new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost',
];

interface LeadFiltersProps {
  origins: OriginOption[];
  profiles: ProfileOption[];
  tags: TagOption[];
  currentStatus: LeadStatus | '';
  currentOriginId: string;
  currentAssignedTo: string;
  currentTagId: string;
  onFilterChange: (key: string, val: string) => void;
}

const selectClasses =
  'block w-full rounded-lg border border-field-border bg-field py-2 pl-3 pr-8 text-sm text-field-fg transition-all hover:border-field-border-hover focus-visible:border-field-border-focus focus-visible:outline-none focus-visible:shadow-focus';

export function LeadFilters({
  origins,
  profiles,
  tags,
  currentStatus,
  currentOriginId,
  currentAssignedTo,
  currentTagId,
  onFilterChange,
}: LeadFiltersProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="filterStatus" className="text-xs text-text-secondary">
          Status
        </Label>
        <select
          id="filterStatus"
          value={currentStatus}
          onChange={(e) => onFilterChange('status', e.target.value)}
          className={selectClasses}
        >
          <option value="">Todos os status</option>
          {LEAD_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filterOrigin" className="text-xs text-text-secondary">
          Origem
        </Label>
        <select
          id="filterOrigin"
          value={currentOriginId}
          onChange={(e) => onFilterChange('originId', e.target.value)}
          className={selectClasses}
        >
          <option value="">Todas as origens</option>
          {origins.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filterAssigned" className="text-xs text-text-secondary">
          Responsável
        </Label>
        <select
          id="filterAssigned"
          value={currentAssignedTo}
          onChange={(e) => onFilterChange('assignedTo', e.target.value)}
          className={selectClasses}
        >
          <option value="">Todos os responsáveis</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filterTag" className="text-xs text-text-secondary">
          Tag
        </Label>
        <select
          id="filterTag"
          value={currentTagId}
          onChange={(e) => onFilterChange('tagId', e.target.value)}
          className={selectClasses}
        >
          <option value="">Todas as tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
