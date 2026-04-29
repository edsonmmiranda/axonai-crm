import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { AuditFilters } from '@/components/admin/audit/AuditFilters';
import { AuditTable } from '@/components/admin/audit/AuditTable';
import { listAuditLogAction } from '@/lib/actions/admin/audit';
import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';
import { createClient } from '@/lib/supabase/server';
import type { AuditFilters as AuditFiltersType, AuditPeriod } from '@/lib/actions/admin/audit.schemas';

export const metadata = { title: 'Axon Admin — Audit log' };

interface SearchParams {
  actions?:        string;
  actorProfileId?: string;
  targetOrgId?:    string;
  targetType?:     string;
  period?:         string;
  from?:           string;
  to?:             string;
}

const PRESET_VALUES = ['24h', '7d', '30d'] as const;

function buildFilters(sp: SearchParams): AuditFiltersType {
  const filters: AuditFiltersType = {};

  if (sp.actions) {
    const list = sp.actions.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length > 0) filters.actions = list;
  }
  if (sp.actorProfileId) filters.actorProfileId = sp.actorProfileId;
  if (sp.targetOrgId)    filters.targetOrgId    = sp.targetOrgId;
  if (sp.targetType)     filters.targetType     = sp.targetType;

  if (sp.period === 'custom' && sp.from && sp.to) {
    filters.period = { preset: 'custom', from: sp.from, to: sp.to } as AuditPeriod;
  } else if (sp.period && (PRESET_VALUES as readonly string[]).includes(sp.period)) {
    filters.period = { preset: sp.period as '24h' | '7d' | '30d' };
  }

  return filters;
}

export default async function AuditPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const admin = await requirePlatformAdmin();
  const sp    = await props.searchParams;

  const filters   = buildFilters(sp);
  const hasFilter =
    Boolean(filters.actions?.length) ||
    Boolean(filters.actorProfileId) ||
    Boolean(filters.targetOrgId) ||
    Boolean(filters.targetType) ||
    Boolean(filters.period);

  const res = await listAuditLogAction(filters);

  // Resolve labels para inputs pré-preenchidos (best-effort).
  let initialOrgLabel: string | null = null;
  if (filters.targetOrgId) {
    const supabase = await createClient();
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', filters.targetOrgId)
      .maybeSingle<{ name: string }>();
    initialOrgLabel = org?.name ?? null;
  }

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
            <li className="font-semibold text-text-primary">Audit log</li>
          </ol>
        </nav>

        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">Audit log</h2>
          <p className="max-w-2xl text-text-secondary">
            Histórico de ações administrativas da plataforma. Use os filtros para responder rapidamente quem fez o quê e quando.
            {admin.role === 'billing' && ' Como billing, você visualiza apenas slugs comerciais (org/plan/subscription/grant).'}
          </p>
        </div>

        <AuditFilters initialOrgLabel={initialOrgLabel} />

        <div className="overflow-hidden rounded-xl border border-border bg-surface-raised shadow-sm">
          {res.success && res.data ? (
            <AuditTable
              initialRows={res.data.rows}
              initialCursor={res.data.nextCursor}
              filters={filters}
              hasFilter={hasFilter}
            />
          ) : (
            <p className="px-6 py-6 text-sm text-feedback-danger-fg">
              {res.error ?? 'Erro ao carregar audit log.'}
            </p>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
