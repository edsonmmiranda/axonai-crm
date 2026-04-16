'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { PRODUCT_PAGE_SIZES, type ProductPageSize } from '@/lib/products/constants';

interface ProductsPaginationProps {
  currentPage: number;
  totalPages: number;
  total: number;
  pageSize: ProductPageSize;
}

function buildPageItems(current: number, total: number): Array<number | 'ellipsis-l' | 'ellipsis-r'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items: Array<number | 'ellipsis-l' | 'ellipsis-r'> = [];
  items.push(1);
  if (current > 3) items.push('ellipsis-l');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    items.push(i);
  }
  if (current < total - 2) items.push('ellipsis-r');
  items.push(total);
  return items;
}

export function ProductsPagination({
  currentPage,
  totalPages,
  total,
  pageSize,
}: ProductsPaginationProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, total);

  function buildHref(target: number): string {
    const params = new URLSearchParams(searchParams.toString());
    if (target > 1) params.set('page', String(target));
    else params.delete('page');
    const qs = params.toString();
    return qs ? `/products?${qs}` : '/products';
  }

  function onPageSizeChange(v: string) {
    const next = Number(v);
    if (!(PRODUCT_PAGE_SIZES as readonly number[]).includes(next)) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === 20) params.delete('pageSize');
    else params.set('pageSize', String(next));
    params.delete('page');
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/products?${qs}` : '/products');
    });
  }

  const pageItems = buildPageItems(currentPage, Math.max(totalPages, 1));

  const btnBase =
    'relative inline-flex items-center px-3 py-2 text-sm font-semibold transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:shadow-focus';
  const btnNormal = 'border border-border bg-surface-raised text-text-primary hover:bg-surface-sunken';
  const btnActive = 'z-10 bg-action-primary text-action-primary-fg border border-action-primary';
  const btnDisabled = 'border border-border bg-surface-raised text-text-muted cursor-not-allowed';

  return (
    <div className="flex flex-col gap-3 border-t border-border-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex flex-col items-start gap-3 text-sm text-text-secondary sm:flex-row sm:items-center sm:gap-4">
        <p>
          Mostrando <span className="font-medium text-text-primary">{start}</span> a{' '}
          <span className="font-medium text-text-primary">{end}</span> de{' '}
          <span className="font-medium text-text-primary">{total}</span> resultados
        </p>
        <div className="flex items-center gap-2 sm:border-l sm:border-border-subtle sm:pl-4">
          <Label htmlFor="productsPageSize" className="whitespace-nowrap">
            Exibir
          </Label>
          <div className="w-24">
            <Select value={String(pageSize)} onValueChange={onPageSizeChange}>
              <SelectTrigger id="productsPageSize" className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRODUCT_PAGE_SIZES.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="whitespace-nowrap">por página</span>
        </div>
      </div>

      {totalPages > 1 ? (
        <nav
          aria-label="Paginação"
          className="isolate inline-flex -space-x-px overflow-hidden rounded-md shadow-sm"
        >
          {currentPage <= 1 ? (
            <span
              className={cn(btnBase, btnDisabled, 'rounded-l-md')}
              aria-disabled="true"
              aria-label="Página anterior"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </span>
          ) : (
            <Link
              href={buildHref(currentPage - 1)}
              className={cn(btnBase, btnNormal, 'rounded-l-md')}
              aria-label="Página anterior"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Link>
          )}

          {pageItems.map((item) => {
            if (item === 'ellipsis-l' || item === 'ellipsis-r') {
              return (
                <span
                  key={item}
                  className={cn(btnBase, 'border border-border bg-surface-raised text-text-secondary')}
                  aria-hidden="true"
                >
                  …
                </span>
              );
            }
            const isActive = item === currentPage;
            if (isActive) {
              return (
                <span
                  key={item}
                  className={cn(btnBase, btnActive)}
                  aria-current="page"
                >
                  {item}
                </span>
              );
            }
            return (
              <Link
                key={item}
                href={buildHref(item)}
                className={cn(btnBase, btnNormal)}
                aria-label={`Ir para página ${item}`}
              >
                {item}
              </Link>
            );
          })}

          {currentPage >= totalPages ? (
            <span
              className={cn(btnBase, btnDisabled, 'rounded-r-md')}
              aria-disabled="true"
              aria-label="Próxima página"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </span>
          ) : (
            <Link
              href={buildHref(currentPage + 1)}
              className={cn(btnBase, btnNormal, 'rounded-r-md')}
              aria-label="Próxima página"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          )}
        </nav>
      ) : null}
    </div>
  );
}
