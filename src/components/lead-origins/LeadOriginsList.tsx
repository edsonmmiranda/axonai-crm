'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { LeadOriginRow } from '@/lib/actions/lead-origins';
import { LeadOriginRowActions } from './LeadOriginRowActions';

interface PaginationMeta {
  total: number;
  totalPages: number;
  currentPage: number;
  itemsPerPage: number;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

interface LeadOriginsListProps {
  origins: LeadOriginRow[];
  hasFilter: boolean;
  metadata?: PaginationMeta;
}

function buildPageUrl(searchParams: URLSearchParams, page: number): string {
  const next = new URLSearchParams(searchParams.toString());
  if (page > 1) next.set('page', String(page));
  else next.delete('page');
  const qs = next.toString();
  return qs ? `/leads/origins?${qs}` : '/leads/origins';
}

export function LeadOriginsList({ origins, hasFilter, metadata }: LeadOriginsListProps) {
  const searchParams = useSearchParams();
  if (origins.length === 0) {
    if (hasFilter) {
      return (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <p className="text-sm font-medium text-text-primary">
            Nenhuma origem encontrada
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
          Nenhuma origem cadastrada
        </p>
        <p className="text-sm text-text-secondary">
          Crie sua primeira origem para começar a rastrear a captação de leads.
        </p>
        <Button asChild className="mt-2">
          <Link href="/leads/origins/new">Criar primeira origem</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
              <th scope="col" className="px-4 py-3 font-semibold">
                Nome
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Tipo
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Plataforma
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Criado em
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                Ações
              </th>
            </tr>
          </thead>
          <tbody>
            {origins.map((origin) => (
              <tr key={origin.id} className="border-b border-border-subtle">
                <td className="px-4 py-3">
                  <Link
                    href={`/leads/origins/${origin.id}`}
                    className="font-medium text-text-primary hover:text-action-primary focus-visible:outline-none focus-visible:shadow-focus rounded"
                  >
                    {origin.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {origin.type}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {origin.platform || '\u2014'}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={origin.is_active ? 'role-admin' : 'status-inactive'}>
                    {origin.is_active ? 'Ativa' : 'Inativa'}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {formatDate(origin.created_at)}
                </td>
                <td className="px-4 py-3">
                  <LeadOriginRowActions
                    id={origin.id}
                    name={origin.name}
                    isActive={origin.is_active}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {metadata && metadata.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border-subtle px-4 pt-4">
          <p className="text-sm text-text-secondary">
            {metadata.total} {metadata.total === 1 ? 'origem' : 'origens'} no total
          </p>
          <div className="flex items-center gap-2">
            {metadata.currentPage > 1 && (
              <Button variant="ghost" size="sm" asChild>
                <Link href={buildPageUrl(searchParams, metadata.currentPage - 1)}>
                  Anterior
                </Link>
              </Button>
            )}
            <span className="text-sm text-text-secondary">
              Página {metadata.currentPage} de {metadata.totalPages}
            </span>
            {metadata.currentPage < metadata.totalPages && (
              <Button variant="ghost" size="sm" asChild>
                <Link href={buildPageUrl(searchParams, metadata.currentPage + 1)}>
                  Próxima
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
