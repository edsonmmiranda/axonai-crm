'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';

import { Label } from '@/components/ui/label';

const selectClasses =
  'block rounded-lg border border-field-border bg-field py-2.5 pl-3 pr-8 text-sm text-field-fg transition-all hover:border-field-border-hover focus-visible:border-field-border-focus focus-visible:outline-none focus-visible:shadow-focus';

export function PlansToolbar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentSearch     = searchParams.get('search') ?? '';
  const currentVisibility = searchParams.get('visibility') ?? '';
  const currentArchived   = searchParams.get('archived') === 'true' ? 'true' : '';

  const [searchValue, setSearchValue] = useState(currentSearch);

  useEffect(() => setSearchValue(currentSearch), [currentSearch]);

  function push(updater: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams.toString());
    updater(next);
    next.delete('page');
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `/admin/plans?${qs}` : '/admin/plans');
    });
  }

  function onSearch(v: string) {
    setSearchValue(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      push((p) => {
        if (v.trim()) p.set('search', v.trim());
        else p.delete('search');
      });
    }, 300);
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface-raised p-4 shadow-sm xl:flex-row xl:items-center">
      <div className="relative flex-1">
        <Label htmlFor="planSearch" className="sr-only">Buscar plano</Label>
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <Search className="size-5 text-text-secondary" aria-hidden="true" />
        </div>
        <input
          id="planSearch"
          type="search"
          placeholder="Buscar por nome do plano..."
          value={searchValue}
          onChange={(e) => onSearch(e.target.value)}
          className="block w-full rounded-lg border border-field-border bg-field py-2.5 pl-10 pr-3 text-sm text-field-fg transition-all placeholder:text-field-placeholder hover:border-field-border-hover focus-visible:border-field-border-focus focus-visible:outline-none focus-visible:shadow-focus"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-row">
        <select
          aria-label="Filtrar por visibilidade"
          value={currentVisibility}
          onChange={(e) => push((p) => { if (e.target.value) p.set('visibility', e.target.value); else p.delete('visibility'); })}
          className={`${selectClasses} w-full lg:w-44`}
        >
          <option value="">Todas as visibilidades</option>
          <option value="public">Públicos</option>
          <option value="private">Privados</option>
        </select>

        <select
          aria-label="Mostrar arquivados"
          value={currentArchived}
          onChange={(e) => push((p) => { if (e.target.value) p.set('archived', 'true'); else p.delete('archived'); })}
          className={`${selectClasses} w-full lg:w-44`}
        >
          <option value="">Apenas ativos</option>
          <option value="true">Arquivados</option>
        </select>
      </div>
    </div>
  );
}
