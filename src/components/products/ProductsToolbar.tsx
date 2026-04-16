'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

interface ProductsToolbarProps {
  categories: CategoryOption[];
}

const CATEGORY_ALL = 'all';
const STATUS_ACTIVE = 'active';
const STATUS_ARCHIVED = 'archived';
const STATUS_ALL = 'all';

export function ProductsToolbar({ categories }: ProductsToolbarProps) {
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
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full sm:max-w-xs">
          <Label htmlFor="productsSearch" className="sr-only">
            Buscar produto
          </Label>
          <Input
            id="productsSearch"
            type="search"
            placeholder="Buscar por nome ou SKU…"
            value={value}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        <div className="w-full sm:w-48">
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

        <div className="w-full sm:w-40">
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
      </div>

      <Button asChild>
        <Link href="/products/new">Novo produto</Link>
      </Button>
    </div>
  );
}
