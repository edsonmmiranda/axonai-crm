'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

interface LeadsSortableHeaderProps {
  sortKey: string;
  label: string;
}

export function LeadsSortableHeader({ sortKey, label }: LeadsSortableHeaderProps) {
  const searchParams = useSearchParams();
  const currentSort = searchParams.get('sortBy') ?? 'created_at';
  const currentOrder = searchParams.get('sortOrder') ?? 'desc';
  const isActive = currentSort === sortKey;

  const nextOrder = isActive && currentOrder === 'asc' ? 'desc' : 'asc';

  const next = new URLSearchParams(searchParams.toString());
  next.set('sortBy', sortKey);
  next.set('sortOrder', nextOrder);
  next.delete('page');
  const href = `/leads?${next.toString()}`;

  return (
    <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">
      <Link
        href={href}
        className="inline-flex items-center gap-1 rounded transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:shadow-focus"
      >
        {label}
        {isActive ? (
          currentOrder === 'asc' ? (
            <ArrowUp className="size-3.5" aria-hidden="true" />
          ) : (
            <ArrowDown className="size-3.5" aria-hidden="true" />
          )
        ) : (
          <ArrowUpDown className="size-3.5 text-text-muted" aria-hidden="true" />
        )}
      </Link>
    </th>
  );
}
