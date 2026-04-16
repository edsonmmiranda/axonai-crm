'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface CategoryOption {
  id: string;
  name: string;
}

interface ProductsFiltersBarProps {
  categories: CategoryOption[];
}

const CATEGORY_ALL = 'all';
const STATUS_ACTIVE = 'active';
const STATUS_ARCHIVED = 'archived';
const STATUS_ALL = 'all';

export function ProductsFiltersBar({ categories }: ProductsFiltersBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentSearch = searchParams.get('search') ?? '';
  const currentCategory = searchParams.get('categoryId') ?? CATEGORY_ALL;
  const currentStatus = searchParams.get('status') ?? STATUS_ACTIVE;

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
      router.push(qs ? `/products?${qs}` : '/products');
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

  function onCategoryChange(v: string) {
    pushParams((p) => {
      if (v === CATEGORY_ALL) p.delete('categoryId');
      else p.set('categoryId', v);
    });
  }

  function onStatusChange(v: string) {
    pushParams((p) => {
      if (v === STATUS_ACTIVE) p.delete('status');
      else p.set('status', v);
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface-raised p-4 shadow-sm xl:flex-row xl:items-center">
      <div className="relative flex-1">
        <Label htmlFor="productsSearch" className="sr-only">
          Buscar produto
        </Label>
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <Search className="size-5 text-text-secondary" aria-hidden="true" />
        </div>
        <input
          id="productsSearch"
          type="search"
          placeholder="Buscar por nome ou SKU…"
          value={value}
          onChange={(e) => onSearchChange(e.target.value)}
          className="block w-full rounded-lg border border-field-border bg-field py-2.5 pl-10 pr-3 text-sm text-field-fg transition-all placeholder:text-field-placeholder hover:border-field-border-hover focus-visible:border-field-border-focus focus-visible:outline-none focus-visible:shadow-focus"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-row">
        <div className="w-full lg:w-52">
          <Label htmlFor="productsCategory" className="sr-only">
            Filtrar por categoria
          </Label>
          <Select value={currentCategory} onValueChange={onCategoryChange}>
            <SelectTrigger id="productsCategory">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CATEGORY_ALL}>Todas as categorias</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-full lg:w-44">
          <Label htmlFor="productsStatus" className="sr-only">
            Filtrar por status
          </Label>
          <Select value={currentStatus} onValueChange={onStatusChange}>
            <SelectTrigger id="productsStatus">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={STATUS_ACTIVE}>Ativos</SelectItem>
              <SelectItem value={STATUS_ARCHIVED}>Arquivados</SelectItem>
              <SelectItem value={STATUS_ALL}>Todos</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button variant="secondary" type="button" disabled className="lg:w-auto">
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          Filtros
        </Button>
      </div>
    </div>
  );
}
