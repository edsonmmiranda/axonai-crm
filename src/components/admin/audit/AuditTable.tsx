'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Loader2, ScrollText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { listAuditLogAction } from '@/lib/actions/admin/audit';
import type { AuditCursor, AuditFilters, AuditLogRow } from '@/lib/actions/admin/audit.schemas';

import { AuditActionBadge } from './AuditActionBadge';

interface Props {
  initialRows:   AuditLogRow[];
  initialCursor: AuditCursor | null;
  filters:       AuditFilters;
  hasFilter:     boolean;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1)    return 'agora';
  if (mins < 60)   return `${mins}min atrás`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)    return `${hrs}h atrás`;
  const days = Math.round(hrs / 24);
  if (days < 7)    return `${days}d atrás`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { timeZoneName: 'short' });
}

function truncateIp(ip: string | null): string {
  if (!ip) return '—';
  return ip.length > 18 ? `${ip.slice(0, 18)}…` : ip;
}

export function AuditTable({ initialRows, initialCursor, filters, hasFilter }: Props) {
  const [rows, setRows] = useState<AuditLogRow[]>(initialRows);
  const [cursor, setCursor] = useState<AuditCursor | null>(initialCursor);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function loadMore() {
    if (!cursor) return;
    setError(null);
    startTransition(async () => {
      const res = await listAuditLogAction(filters, cursor);
      if (!res.success || !res.data) {
        setError(res.error ?? 'Falha ao carregar mais linhas.');
        return;
      }
      setRows((prev) => [...prev, ...res.data!.rows]);
      setCursor(res.data.nextCursor);
    });
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <ScrollText className="size-10 text-text-muted" aria-hidden="true" />
        <p className="text-sm font-medium text-text-primary">
          {hasFilter ? 'Nenhuma linha encontrada com os filtros atuais' : 'Nenhuma linha de audit registrada'}
        </p>
        {hasFilter && (
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/audit">Limpar filtros</Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border-subtle bg-surface-sunken text-xs uppercase text-text-secondary">
            <tr>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Quando</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Quem</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Ação</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Alvo</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">Org</th>
              <th scope="col" className="px-3 py-3.5 font-semibold tracking-wide">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {rows.map((row) => (
              <tr key={row.id} className="group transition-colors hover:bg-surface-sunken/80">
                <td className="whitespace-nowrap px-3 py-3 text-text-secondary">
                  <Link
                    href={`/admin/audit/${row.id}`}
                    className="rounded text-text-primary transition-colors hover:text-action-primary focus-visible:outline-none focus-visible:shadow-focus"
                    title={formatAbsolute(row.occurredAt)}
                  >
                    {formatRelative(row.occurredAt)}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-text-secondary">
                  {row.actorEmailSnapshot ?? <span className="text-text-muted">—</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-3">
                  <AuditActionBadge action={row.action} />
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-text-secondary">
                  <span className="font-mono text-xs">{row.targetType}</span>
                  {row.targetId && (
                    <span className="ml-1 font-mono text-xs text-text-muted">{row.targetId.slice(0, 8)}…</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-text-secondary">
                  {row.targetOrganizationId ? (
                    <span className="font-mono text-xs">{row.targetOrganizationId.slice(0, 8)}…</span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-text-secondary">
                  {truncateIp(row.ipAddress)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col items-center gap-2 border-t border-border-subtle px-4 py-4 sm:flex-row sm:justify-between sm:px-6">
        <p className="text-sm text-text-secondary">
          {rows.length} {rows.length === 1 ? 'linha carregada' : 'linhas carregadas'}
          {!cursor && rows.length > 0 && ' (fim)'}
        </p>
        {cursor && (
          <Button type="button" variant="secondary" onClick={loadMore} disabled={isPending}>
            {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Carregar mais
          </Button>
        )}
      </div>

      {error && (
        <p className="border-t border-feedback-danger-border bg-feedback-danger-bg px-4 py-2 text-sm text-feedback-danger-fg">
          {error}
        </p>
      )}
    </>
  );
}
