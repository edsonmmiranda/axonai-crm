'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';

import { Label } from '@/components/ui/label';

const selectClasses =
  'block rounded-lg border border-field-border bg-field py-2 pl-3 pr-8 text-sm text-field-fg transition-all hover:border-field-border-hover focus-visible:border-field-border-focus focus-visible:outline-none focus-visible:shadow-focus';

interface PlanOption {
  id: string;
  name: string;
}

interface Props {
  plans: PlanOption[];
}

export function OrganizationsToolbar({ plans }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentSearch   = searchParams.get('search') ?? '';
  const currentIsActive = searchParams.get('isActive') ?? '';
  const currentPlanId   = searchParams.get('planId') ?? '';
  const currentStatus   = searchParams.get('subStatus') ?? '';

  const [searchValue, setSearchValue] = useState(currentSearch);

  useEffect(() => setSearchValue(currentSearch), [currentSearch]);

  function push(updater: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams.toString());
    updater(next);
    next.delete('page');
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `/admin/organizations?${qs}` : '/admin/organizations');
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
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface-raised p-4 shadow-sm">
      <div className="relative">
        <Label htmlFor="orgSearch" className="sr-only">Buscar organização</Label>
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <Search className="size-5 text-text-secondary" aria-hidden="true" />
        </div>
        <input
          id="orgSearch"
          type="search"
          placeholder="Buscar por nome ou slug..."
          value={searchValue}
          onChange={(e) => onSearch(e.target.value)}
          className="block w-full rounded-lg border border-field-border bg-field py-2.5 pl-10 pr-3 text-sm text-field-fg transition-all placeholder:text-field-placeholder hover:border-field-border-hover focus-visible:border-field-border-focus focus-visible:outline-none focus-visible:shadow-focus"
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          aria-label="Filtrar por estado"
          value={currentIsActive}
          onChange={(e) => push((p) => { if (e.target.value) p.set('isActive', e.target.value); else p.delete('isActive'); })}
          className={selectClasses}
        >
          <option value="">Todas (ativas e suspensas)</option>
          <option value="true">Apenas ativas</option>
          <option value="false">Apenas suspensas</option>
        </select>

        <select
          aria-label="Filtrar por plano"
          value={currentPlanId}
          onChange={(e) => push((p) => { if (e.target.value) p.set('planId', e.target.value); else p.delete('planId'); })}
          className={selectClasses}
        >
          <option value="">Todos os planos</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <select
          aria-label="Filtrar por status de assinatura"
          value={currentStatus}
          onChange={(e) => push((p) => { if (e.target.value) p.set('subStatus', e.target.value); else p.delete('subStatus'); })}
          className={selectClasses}
        >
          <option value="">Todos os status</option>
          <option value="trial">Trial</option>
          <option value="ativa">Ativa</option>
          <option value="past_due">Atrasada</option>
          <option value="trial_expired">Trial expirado</option>
          <option value="cancelada">Cancelada</option>
          <option value="suspensa">Suspensa</option>
        </select>
      </div>
    </div>
  );
}
