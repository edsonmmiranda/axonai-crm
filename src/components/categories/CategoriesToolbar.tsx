'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function CategoriesToolbar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentSearch = searchParams.get('search') ?? '';
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
      router.push(qs ? `/settings/catalog/categories?${qs}` : '/settings/catalog/categories');
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

  function onToggleInactive(checked: boolean) {
    pushParams((p) => {
      if (checked) p.set('showInactive', '1');
      else p.delete('showInactive');
    });
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="w-full sm:max-w-xs">
        <Label htmlFor="categoriesSearch" className="sr-only">
          Buscar categoria
        </Label>
        <Input
          id="categoriesSearch"
          type="search"
          placeholder="Buscar por nome…"
          value={value}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id="showInactive"
          checked={showInactive}
          onCheckedChange={onToggleInactive}
        />
        <Label htmlFor="showInactive" className="text-sm text-text-secondary">
          Mostrar inativas
        </Label>
      </div>
    </div>
  );
}
