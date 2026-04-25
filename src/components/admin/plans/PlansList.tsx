'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PlanStatusBadge } from './PlanStatusBadge';
import { PlansRowActions } from './PlansRowActions';
import type { PlanListItem } from '@/lib/actions/admin/plans';
import type { PlatformAdminRole } from '@/lib/auth/platformAdmin';

interface PaginationMeta {
  total: number;
  totalPages: number;
  currentPage: number;
  itemsPerPage: number;
}

interface Props {
  items: PlanListItem[];
  metadata?: PaginationMeta;
  adminRole: PlatformAdminRole;
  hasFilter: boolean;
}

function formatBRL(cents: number) {
  if (cents === 0) return 'Grátis';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatLimit(val: number | null) {
  return val === null ? '∞' : val.toLocaleString('pt-BR');
}

function buildPageUrl(searchParams: URLSearchParams, page: number): string {
  const next = new URLSearchParams(searchParams.toString());
  if (page > 1) next.set('page', String(page));
  else next.delete('page');
  const qs = next.toString();
  return qs ? `/admin/plans?${qs}` : '/admin/plans';
}

function buildPageItems(current: number, total: number): Array<number | 'ellipsis-l' | 'ellipsis-r'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items: Array<number | 'ellipsis-l' | 'ellipsis-r'> = [1];
  if (current > 3) items.push('ellipsis-l');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) items.push(i);
  if (current < total - 2) items.push('ellipsis-r');
  items.push(total);
  return items;
}

export function PlansList({ items, metadata, adminRole, hasFilter }: Props) {
  const searchParams = useSearchParams();

  if (items.length === 0) {
    if (hasFilter) {
      return (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <p className="text-sm font-medium text-text-primary">Nenhum plano encontrado</p>
          <p className="text-sm text-text-secondary">Tente ajustar a busca ou remover filtros.</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <p className="text-sm font-medium text-text-primary">Nenhum plano cadastrado</p>
        <p className="text-sm text-text-secondary">Crie o primeiro plano para começar.</p>
        {adminRole === 'owner' && (
          <Button asChild className="mt-2">
            <Link href="/admin/plans/new">Novo plano</Link>
          </Button>
        )}
      </div>
    );
  }

  const total       = metadata?.total ?? items.length;
  const currentPage = metadata?.currentPage ?? 1;
  const totalPages  = metadata?.totalPages ?? 1;
  const pageSize    = metadata?.itemsPerPage ?? 25;
  const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end   = Math.min(currentPage * pageSize, total);
  const pageItems = buildPageItems(currentPage, Math.max(totalPages, 1));

  const btnBase    = 'relative inline-flex items-center px-3 py-2 text-sm font-semibold transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:shadow-focus';
  const btnNormal  = 'border border-border bg-surface-raised text-text-primary hover:bg-surface-sunken';
  const btnActive  = 'z-10 bg-action-primary text-action-primary-fg border border-action-primary';
  const btnDisabled = 'border border-border bg-surface-raised text-text-muted cursor-not-allowed';

  return (
    <>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border-subtle bg-surface-sunken text-xs uppercase text-text-secondary">
            <tr>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Nome</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Mensal</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Anual</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Usuários</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Leads</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Status</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Subs ativas</th>
              <th scope="col" className="py-3.5 pl-3 pr-6 text-right font-semibold tracking-wide">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {items.map((plan) => (
              <tr key={plan.id} className="group transition-colors hover:bg-surface-sunken/80">
                <td className="whitespace-nowrap px-3 py-4">
                  <div className="flex flex-col gap-0.5">
                    {adminRole === 'owner' && !plan.isArchived ? (
                      <Link
                        href={`/admin/plans/${plan.id}/edit`}
                        className="rounded font-bold text-text-primary transition-colors hover:text-action-primary focus-visible:outline-none focus-visible:shadow-focus"
                      >
                        {plan.name}
                      </Link>
                    ) : (
                      <span className="font-bold text-text-primary">{plan.name}</span>
                    )}
                    {plan.description && (
                      <span className="text-xs text-text-secondary">{plan.description}</span>
                    )}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-4">
                  <span className="font-semibold text-text-primary">{formatBRL(plan.priceMonthly)}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-text-secondary">{formatBRL(plan.priceYearly)}</td>
                <td className="whitespace-nowrap px-3 py-4 text-text-secondary">{formatLimit(plan.maxUsers)}</td>
                <td className="whitespace-nowrap px-3 py-4 text-text-secondary">{formatLimit(plan.maxLeads)}</td>
                <td className="whitespace-nowrap px-3 py-4">
                  <PlanStatusBadge isArchived={plan.isArchived} isPublic={plan.isPublic} />
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-text-secondary">{plan.activeSubscriptionsCount}</td>
                <td className="whitespace-nowrap py-4 pl-3 pr-6 text-right">
                  <div className="flex items-center justify-end">
                    <PlansRowActions plan={plan} adminRole={adminRole} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 border-t border-border-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-sm text-text-secondary">
          Mostrando <span className="font-medium text-text-primary">{start}</span> a{' '}
          <span className="font-medium text-text-primary">{end}</span> de{' '}
          <span className="font-medium text-text-primary">{total}</span>{' '}
          {total === 1 ? 'resultado' : 'resultados'}
        </p>

        {totalPages > 1 && (
          <nav aria-label="Paginação" className="isolate inline-flex -space-x-px overflow-hidden rounded-md shadow-sm">
            {currentPage <= 1 ? (
              <span className={cn(btnBase, btnDisabled, 'rounded-l-md')} aria-disabled="true" aria-label="Página anterior">
                <ChevronLeft className="size-4" aria-hidden="true" />
              </span>
            ) : (
              <Link href={buildPageUrl(searchParams, currentPage - 1)} className={cn(btnBase, btnNormal, 'rounded-l-md')} aria-label="Página anterior">
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Link>
            )}

            {pageItems.map((item) => {
              if (item === 'ellipsis-l' || item === 'ellipsis-r') {
                return (
                  <span key={item} className={cn(btnBase, 'border border-border bg-surface-raised text-text-secondary')} aria-hidden="true">…</span>
                );
              }
              const isActive = item === currentPage;
              return isActive ? (
                <span key={item} className={cn(btnBase, btnActive)} aria-current="page">{item}</span>
              ) : (
                <Link key={item} href={buildPageUrl(searchParams, item)} className={cn(btnBase, btnNormal)} aria-label={`Ir para página ${item}`}>{item}</Link>
              );
            })}

            {currentPage >= totalPages ? (
              <span className={cn(btnBase, btnDisabled, 'rounded-r-md')} aria-disabled="true" aria-label="Próxima página">
                <ChevronRight className="size-4" aria-hidden="true" />
              </span>
            ) : (
              <Link href={buildPageUrl(searchParams, currentPage + 1)} className={cn(btnBase, btnNormal, 'rounded-r-md')} aria-label="Próxima página">
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
