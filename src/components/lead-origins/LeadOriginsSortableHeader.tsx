'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { LeadOriginSortKey } from '@/lib/lead-origins/constants';
import { parseSortParam, serializeSortParam } from './sort-utils';

interface LeadOriginsSortableHeaderProps {
  sortKey: LeadOriginSortKey;
  label: string;
  align?: 'left' | 'right';
  className?: string;
}

export function LeadOriginsSortableHeader({
  sortKey,
  label,
  align = 'left',
  className,
}: LeadOriginsSortableHeaderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const rules = parseSortParam(searchParams.get('sort'));
  const ruleIndex = rules.findIndex((r) => r.key === sortKey);
  const rule = ruleIndex >= 0 ? rules[ruleIndex] : null;

  function onToggle() {
    const next = [...rules];
    if (ruleIndex >= 0) {
      if (next[ruleIndex].dir === 'asc') {
        next[ruleIndex] = { ...next[ruleIndex], dir: 'desc' };
      } else {
        next.splice(ruleIndex, 1);
      }
    } else {
      next.push({ key: sortKey, dir: 'asc' });
    }
    const params = new URLSearchParams(searchParams.toString());
    const serialized = serializeSortParam(next);
    if (serialized) params.set('sort', serialized);
    else params.delete('sort');
    params.delete('page');
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/leads/origins?${qs}` : '/leads/origins');
    });
  }

  const Icon = rule ? (rule.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <th
      scope="col"
      className={cn(
        'group select-none px-3 py-3.5 font-semibold tracking-wide',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={`Ordenar por ${label}`}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-sm transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:shadow-focus',
          align === 'right' && 'flex-row-reverse',
        )}
      >
        <span>{label}</span>
        <span
          className={cn(
            'inline-flex transition-opacity',
            rule ? 'text-action-primary opacity-100' : 'text-text-muted opacity-0 group-hover:opacity-100',
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
      </button>
    </th>
  );
}
