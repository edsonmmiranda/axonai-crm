import { Building2, Users, TrendingUp } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { KpiCard } from '@/components/admin/dashboard/KpiCard';
import { RefreshNowButton } from '@/components/admin/dashboard/RefreshNowButton';
import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';
import { getDashboardMetricsAction } from '@/lib/actions/admin/platform-metrics';

export const metadata = { title: 'Axon Admin — Dashboard' };

export default async function AdminDashboardPage() {
  const admin = await requirePlatformAdmin();
  const result = await getDashboardMetricsAction();
  const metrics = result.data;

  const canRefresh = admin.role === 'owner' || admin.role === 'support';

  return (
    <AdminShell admin={admin}>
      <div className="mr-auto flex max-w-page flex-col gap-6 pb-10">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-3xl font-bold tracking-tight text-text-primary">Dashboard</h2>
            <p className="text-text-secondary">Visão geral da plataforma Axon AI.</p>
          </div>
          {metrics && (
            <RefreshNowButton
              refreshedAt={metrics.refreshedAt}
              canRefresh={canRefresh}
            />
          )}
        </div>

        {!result.success ? (
          <div className="rounded-xl border border-feedback-danger-border bg-feedback-danger-bg p-4 text-sm text-feedback-danger-fg">
            {result.error ?? 'Erro ao carregar métricas.'}
          </div>
        ) : metrics ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard
              label="Orgs ativas"
              value={metrics.activeOrgsCount}
              icon={<Building2 className="size-16" />}
              description="Exclui a org interna Axon AI"
            />
            <KpiCard
              label="Usuários ativos"
              value={metrics.activeUsersCount}
              icon={<Users className="size-16" />}
              description="Usuários de orgs clientes ativas"
            />
            <KpiCard
              label="Leads totais"
              value={metrics.leadsTotal}
              icon={<TrendingUp className="size-16" />}
              description="Leads de orgs clientes ativas"
            />
          </div>
        ) : null}

        {metrics?.isStaleAfterFetch && (
          <p className="text-xs text-text-muted">
            Métricas podem estar desatualizadas. Clique em &quot;Atualizar&quot; para recalcular.
          </p>
        )}
      </div>
    </AdminShell>
  );
}
