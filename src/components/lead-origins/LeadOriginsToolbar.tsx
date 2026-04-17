'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Search } from 'lucide-react';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

const TYPE_OPTIONS = [
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'referral', label: 'Indicação' },
  { value: 'social', label: 'Redes Sociais' },
  { value: 'evento', label: 'Evento' },
  { value: 'outro', label: 'Outro' },
];

export function LeadOriginsToolbar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentSearch = searchParams.get('search') ?? '';
  const currentType = searchParams.get('type') ?? '';
  const showInactive = searchParams.get('showInactive') === '1';

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
      router.push(qs ? `/leads/origins?${qs}` : '/leads/origins');
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

  function onTypeChange(v: string) {
    pushParams((p) => {
      if (v && v !== 'all') p.set('type', v);
      else p.delete('type');
    });
  }

  function onToggleInactive(checked: boolean) {
    pushParams((p) => {
      if (checked) p.set('showInactive', '1');
      else p.delete('showInactive');
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface-raised p-4 shadow-sm xl:flex-row xl:items-center">
      <div className="relative flex-1">
        <Label htmlFor="originsSearch" className="sr-only">
          Buscar origem
        </Label>
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <Search className="size-5 text-text-secondary" aria-hidden="true" />
        </div>
        <input
          id="originsSearch"
          type="search"
          placeholder="Buscar por nome..."
          value={value}
          onChange={(e) => onSearchChange(e.target.value)}
          className="block w-full rounded-lg border border-field-border bg-field py-2.5 pl-10 pr-3 text-sm text-field-fg transition-all placeholder:text-field-placeholder hover:border-field-border-hover focus-visible:border-field-border-focus focus-visible:outline-none focus-visible:shadow-focus"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-row lg:items-center">
        <div className="w-full lg:w-44">
          <Label htmlFor="originsType" className="sr-only">
            Filtrar por tipo
          </Label>
          <Select value={currentType || 'all'} onValueChange={onTypeChange}>
            <SelectTrigger id="originsType">
              <SelectValue placeholder="Todos os tipos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              {TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="showInactive"
            checked={showInactive}
            onCheckedChange={onToggleInactive}
          />
          <Label htmlFor="showInactive" className="whitespace-nowrap text-sm text-text-secondary">
            Mostrar inativas
          </Label>
        </div>
      </div>
    </div>
  );
}
