import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight, ArrowLeft } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { AuditActionBadge } from '@/components/admin/audit/AuditActionBadge';
import { DiffTable } from '@/components/admin/audit/DiffTable';
import { JsonView } from '@/components/admin/audit/JsonView';
import { Button } from '@/components/ui/button';
import { getAuditLogEntryAction } from '@/lib/actions/admin/audit';
import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';

export const metadata = { title: 'Axon Admin — Detalhe do audit' };

interface RouteParams {
  id: string;
}

function targetHref(targetType: string, targetId: string | null): string | null {
  if (!targetId) return null;
  if (targetType === 'organization')    return `/admin/organizations/${targetId}`;
  if (targetType === 'platform_admin')  return `/admin/admins/${targetId}`;
  return null;
}

export default async function AuditDetailPage(props: {
  params: Promise<RouteParams>;
}) {
  const admin  = await requirePlatformAdmin();
  const params = await props.params;

  const res = await getAuditLogEntryAction(params.id);
  if (!res.success || !res.data) {
    notFound();
  }
  const row = res.data;

  const occurredAbs = new Date(row.occurredAt).toLocaleString('pt-BR', { timeZoneName: 'short' });
  const occurredIso = row.occurredAt;

  const hasDiffBefore = row.diffBefore && Object.keys(row.diffBefore).length > 0;
  const hasDiffAfter  = row.diffAfter  && Object.keys(row.diffAfter).length  > 0;
  const targetUrl     = targetHref(row.targetType, row.targetId);

  return (
    <AdminShell admin={admin}>
      <div className="mr-auto flex max-w-page flex-col gap-6 pb-10">
        <nav className="flex text-sm font-medium text-text-secondary" aria-label="breadcrumb">
          <ol className="flex items-center gap-2">
            <li>
              <Link
                href="/admin/dashboard"
                className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
              >
                Dashboard
              </Link>
            </li>
            <li aria-hidden="true"><ChevronRight className="size-4 text-text-muted" /></li>
            <li>
              <Link
                href="/admin/audit"
                className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
              >
                Audit log
              </Link>
            </li>
            <li aria-hidden="true"><ChevronRight className="size-4 text-text-muted" /></li>
            <li className="font-mono text-xs font-semibold text-text-primary">{row.id.slice(0, 8)}…</li>
          </ol>
        </nav>

        <div className="flex flex-col gap-3">
          <Button asChild variant="ghost" size="sm" className="w-fit">
            <Link href="/admin/audit">
              <ArrowLeft className="size-4" />
              Voltar para a lista
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <AuditActionBadge action={row.action} />
            <time dateTime={occurredIso} className="text-sm text-text-secondary">
              {occurredAbs}
            </time>
          </div>
        </div>

        <div className="flex flex-col gap-6 rounded-xl border border-border bg-surface-raised p-6 shadow-sm">
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">Contexto</h3>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-text-muted">Ator</dt>
                <dd className="text-sm text-text-primary">
                  {row.actorEmailSnapshot ?? <span className="text-text-muted">—</span>}
                </dd>
                {row.actorProfileId && (
                  <span className="font-mono text-xs text-text-muted">{row.actorProfileId}</span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-text-muted">Alvo</dt>
                <dd className="text-sm text-text-primary">
                  <span className="font-mono text-xs">{row.targetType}</span>
                  {targetUrl ? (
                    <Link
                      href={targetUrl}
                      className="ml-2 rounded text-action-ghost-fg hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                    >
                      {row.targetId}
                    </Link>
                  ) : row.targetId ? (
                    <span className="ml-2 font-mono text-xs text-text-secondary">{row.targetId}</span>
                  ) : (
                    <span className="ml-2 text-text-muted">—</span>
                  )}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-text-muted">Organização</dt>
                <dd className="text-sm text-text-primary">
                  {row.targetOrganizationId ? (
                    <Link
                      href={`/admin/organizations/${row.targetOrganizationId}`}
                      className="font-mono text-xs text-action-ghost-fg hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                    >
                      {row.targetOrganizationId}
                    </Link>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-text-muted">Origem</dt>
                <dd className="font-mono text-xs text-text-primary">
                  {row.ipAddress ?? <span className="text-text-muted">—</span>}
                </dd>
                {row.userAgent && (
                  <span
                    className="line-clamp-2 text-xs text-text-muted"
                    title={row.userAgent}
                  >
                    {row.userAgent}
                  </span>
                )}
              </div>
            </dl>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">Diff</h3>
            {hasDiffBefore && hasDiffAfter ? (
              <DiffTable before={row.diffBefore} after={row.diffAfter} />
            ) : hasDiffAfter ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-text-muted">Estado criado:</p>
                <JsonView value={row.diffAfter} />
              </div>
            ) : hasDiffBefore ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-text-muted">Estado anterior:</p>
                <JsonView value={row.diffBefore} />
              </div>
            ) : (
              <p className="text-sm italic text-text-muted">Sem diff registrado para esta ação.</p>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">Metadata</h3>
            <JsonView value={row.metadata} emptyLabel="Sem metadata adicional." />
          </section>
        </div>
      </div>
    </AdminShell>
  );
}
