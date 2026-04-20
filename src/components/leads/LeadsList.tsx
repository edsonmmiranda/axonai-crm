'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TagBadge } from '@/components/tags/TagBadge';
import type { TagColor } from '@/lib/tags/constants';
import type { LeadRow, LossReasonOption, ProfileOption } from '@/lib/actions/leads';
import type { LeadStatus } from '@/lib/actions/leads';
import { LeadStatusBadge } from './LeadStatusBadge';
import { LeadsSortableHeader } from './LeadsSortableHeader';
import { LeadRowActions } from './LeadRowActions';

interface PaginationMeta {
  total: number;
  totalPages: number;
  currentPage: number;
  itemsPerPage: number;
}

interface LeadsListProps {
  leads: LeadRow[];
  lossReasons: LossReasonOption[];
  profiles: ProfileOption[];
  isAdmin: boolean;
  hasFilter: boolean;
  metadata?: PaginationMeta;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function buildPageUrl(searchParams: URLSearchParams, page: number): string {
  const next = new URLSearchParams(searchParams.toString());
  if (page > 1) next.set('page', String(page));
  else next.delete('page');
  const qs = next.toString();
  return qs ? `/leads?${qs}` : '/leads';
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

export function LeadsList({ leads, lossReasons, profiles, isAdmin, hasFilter, metadata }: LeadsListProps) {
  const searchParams = useSearchParams();

  if (leads.length === 0) {
    if (hasFilter) {
      return (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <p className="text-sm font-medium text-text-primary">
            Nenhum lead encontrado
          </p>
          <p className="text-sm text-text-secondary">
            Tente ajustar a busca ou remover filtros.
          </p>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <p className="text-sm font-medium text-text-primary">
          Nenhum lead cadastrado
        </p>
        <p className="text-sm text-text-secondary">
          Crie seu primeiro lead para começar a gerenciar seu funil de vendas.
        </p>
        <Button asChild className="mt-2">
          <Link href="/leads/new">Cadastrar primeiro lead</Link>
        </Button>
      </div>
    );
  }

  const total = metadata?.total ?? leads.length;
  const currentPage = metadata?.currentPage ?? 1;
  const totalPages = metadata?.totalPages ?? 1;
  const pageSize = metadata?.itemsPerPage ?? 20;
  const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, total);

  const pageItems = buildPageItems(currentPage, Math.max(totalPages, 1));

  const btnBase =
    'relative inline-flex items-center px-3 py-2 text-sm font-semibold transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:shadow-focus';
  const btnNormal =
    'border border-border bg-surface-raised text-text-primary hover:bg-surface-sunken';
  const btnActive =
    'z-10 bg-action-primary text-action-primary-fg border border-action-primary';
  const btnDisabled =
    'border border-border bg-surface-raised text-text-muted cursor-not-allowed';

  return (
    <>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border-subtle bg-surface-sunken text-xs uppercase text-text-secondary">
            <tr>
              <LeadsSortableHeader sortKey="name" label="Nome" />
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">
                Email
              </th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">
                Empresa
              </th>
              <LeadsSortableHeader sortKey="status" label="Status" />
              <LeadsSortableHeader sortKey="score" label="Score" />
              <LeadsSortableHeader sortKey="value" label="Valor" />
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">
                Tags
              </th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">
                Responsável
              </th>
              <LeadsSortableHeader sortKey="created_at" label="Criado" />
              <th scope="col" className="py-3.5 pl-3 pr-6 text-right font-semibold tracking-wide">
                Ações
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {leads.map((lead) => (
              <tr
                key={lead.id}
                className="group transition-colors hover:bg-surface-sunken/80"
              >
                <td className="whitespace-nowrap px-3 py-4">
                  <Link
                    href={`/leads/${lead.id}`}
                    className="rounded font-bold text-text-primary transition-colors hover:text-action-primary focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    {lead.name}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-text-secondary">
                  {lead.email ?? '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-text-secondary">
                  {lead.company ?? '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-4">
                  <LeadStatusBadge status={lead.status as LeadStatus} />
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-text-secondary">
                  {lead.score}
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-text-secondary">
                  {lead.value > 0 ? formatCurrency(lead.value) : '—'}
                </td>
                <td className="px-3 py-4">
                  {lead.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {lead.tags.map((tag) => (
                        <TagBadge
                          key={tag.id}
                          name={tag.name}
                          color={tag.color as TagColor}
                        />
                      ))}
                    </div>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-text-secondary">
                  {lead.assigned_to_name ?? '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-text-secondary">
                  {formatDate(lead.created_at)}
                </td>
                <td className="whitespace-nowrap py-4 pl-3 pr-6 text-right">
                  <LeadRowActions
                    lead={lead}
                    lossReasons={lossReasons}
                    profiles={profiles}
                    isAdmin={isAdmin}
                  />
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
                href={buildPageUrl(searchParams, currentPage - 1)}
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
                  href={buildPageUrl(searchParams, item)}
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
                href={buildPageUrl(searchParams, currentPage + 1)}
                className={cn(btnBase, btnNormal, 'rounded-r-md')}
                aria-label="Próxima página"
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            )}
          </nav>
        ) : null}
      </div>
    </>
  );
}
