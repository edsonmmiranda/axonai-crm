'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Shield } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { OrganizationStatusBadge } from './OrganizationStatusBadge';
import { OrganizationsRowActions } from './OrganizationsRowActions';
import type { OrgListItem } from '@/lib/actions/admin/organizations';
import type { PlatformAdminRole } from '@/lib/auth/platformAdmin';

interface PaginationMeta {
  total: number;
  totalPages: number;
  currentPage: number;
  itemsPerPage: number;
}

interface Props {
  items: OrgListItem[];
  metadata?: PaginationMeta;
  adminRole: PlatformAdminRole;
  hasFilter: boolean;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function buildPageUrl(searchParams: URLSearchParams, page: number): string {
  const next = new URLSearchParams(searchParams.toString());
  if (page > 1) next.set('page', String(page));
  else next.delete('page');
  const qs = next.toString();
  return qs ? `/admin/organizations?${qs}` : '/admin/organizations';
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

export function OrganizationsList({ items, metadata, adminRole, hasFilter }: Props) {
  const searchParams = useSearchParams();

  if (items.length === 0) {
    if (hasFilter) {
      return (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <p className="text-sm font-medium text-text-primary">Nenhuma organização encontrada</p>
          <p className="text-sm text-text-secondary">Tente ajustar a busca ou remover filtros.</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <p className="text-sm font-medium text-text-primary">Nenhuma organização cadastrada</p>
        <p className="text-sm text-text-secondary">Crie a primeira organização para começar.</p>
        {adminRole === 'owner' && (
          <Button asChild className="mt-2">
            <Link href="/admin/organizations/new">Nova organização</Link>
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
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Slug</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Plano</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Status</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Estado</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Usuários</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Criada em</th>
              <th scope="col" className="py-3.5 pl-3 pr-6 text-right font-semibold tracking-wide">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {items.map((org) => (
              <tr key={org.id} className="group transition-colors hover:bg-surface-sunken/80">
                <td className="whitespace-nowrap px-3 py-4">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/admin/organizations/${org.id}`}
                      className="rounded font-bold text-text-primary transition-colors hover:text-action-primary focus-visible:outline-none focus-visible:shadow-focus"
                    >
                      {org.name}
                    </Link>
                    {org.isInternal && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunken border border-border-subtle px-2 py-0.5 text-xs text-text-muted">
                        <Shield className="size-3" />
                        Interna
                      </span>
                    )}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-text-secondary font-mono text-xs">{org.slug}</td>
                <td className="whitespace-nowrap px-3 py-4 text-text-secondary">
                  {org.subscription?.planName ?? '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-4">
                  <OrganizationStatusBadge status={org.subscription?.status ?? null} />
                </td>
                <td className="whitespace-nowrap px-3 py-4">
                  <Badge variant={org.isActive ? 'role-owner' : 'status-expired'}>
                    {org.isActive ? 'Ativa' : 'Suspensa'}
                  </Badge>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-text-secondary">{org.usersCount}</td>
                <td className="whitespace-nowrap px-3 py-4 text-text-secondary">{formatDate(org.createdAt)}</td>
                <td className="whitespace-nowrap py-4 pl-3 pr-6 text-right">
                  <OrganizationsRowActions org={org} adminRole={adminRole} />
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
