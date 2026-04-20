'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Search } from 'lucide-react';

import { Label } from '@/components/ui/label';
import type { OriginOption, ProfileOption, TagOption } from '@/lib/actions/leads';
import type { LeadStatus } from '@/lib/actions/leads';
import { LeadFilters } from './LeadFilters';

interface LeadsToolbarProps {
  origins: OriginOption[];
  profiles: ProfileOption[];
  tags: TagOption[];
}

export function LeadsToolbar({ origins, profiles, tags }: LeadsToolbarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentSearch = searchParams.get('search') ?? '';

  const [value, setValue] = useState(currentSearch);
  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValue(currentSearch);
  }, [currentSearch]);

  function pushParams(updater: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams.toString());
    updater(next);
    next.delete('page');
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `/leads?${qs}` : '/leads');
    });
  }

  function onSearchChange(v: string) {
    setValue(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushParams((p) => {
        if (v.trim()) p.set('search', v.trim());
        else p.delete('search');
      });
    }, 300);
  }

  function onFilterChange(key: string, val: string) {
    pushParams((p) => {
      if (val) p.set(key, val);
      else p.delete(key);
    });
  }

  const currentStatus = (searchParams.get('status') ?? '') as LeadStatus | '';
  const currentOriginId = searchParams.get('originId') ?? '';
  const currentAssignedTo = searchParams.get('assignedTo') ?? '';
  const currentTagId = searchParams.get('tagId') ?? '';

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface-raised p-4 shadow-sm">
      <div className="relative flex-1">
        <Label htmlFor="leadsSearch" className="sr-only">
          Buscar lead
        </Label>
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <Search className="size-5 text-text-secondary" aria-hidden="true" />
        </div>
        <input
          id="leadsSearch"
          type="search"
          placeholder="Buscar por nome, email, telefone ou empresa..."
          value={value}
          onChange={(e) => onSearchChange(e.target.value)}
          className="block w-full rounded-lg border border-field-border bg-field py-2.5 pl-10 pr-3 text-sm text-field-fg transition-all placeholder:text-field-placeholder hover:border-field-border-hover focus-visible:border-field-border-focus focus-visible:outline-none focus-visible:shadow-focus"
        />
      </div>

      <LeadFilters
        origins={origins}
        profiles={profiles}
        tags={tags}
        currentStatus={currentStatus}
        currentOriginId={currentOriginId}
        currentAssignedTo={currentAssignedTo}
        currentTagId={currentTagId}
        onFilterChange={onFilterChange}
      />
    </div>
  );
}
