import { AdminShell } from '@/components/admin/AdminShell';
import { FeatureFlagsList } from '@/components/admin/settings/FeatureFlagsList';
import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';
import { getFeatureFlagsAction } from '@/lib/actions/admin/feature-flags';

export const metadata = { title: 'Axon Admin — Feature Flags' };

export default async function FeatureFlagsPage() {
  const admin = await requirePlatformAdmin();
  const result = await getFeatureFlagsAction();
  const flags = result.success ? (result.data ?? []) : [];

  return (
    <AdminShell admin={admin}>
      <div className="mr-auto flex max-w-page flex-col gap-6 pb-10">
        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">Feature Flags</h2>
          <p className="text-text-secondary">
            Ative ou desative funcionalidades sem precisar de deploy.
          </p>
        </div>

        {!result.success && (
          <div className="rounded-xl border border-feedback-danger-border bg-feedback-danger-bg p-4 text-sm text-feedback-danger-fg">
            Erro ao carregar feature flags.
          </div>
        )}

        <FeatureFlagsList flags={flags} canMutate={admin.role === 'owner'} />

        <p className="text-xs text-text-muted">
          Novas flags precisam ser registradas no código em{' '}
          <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono">
            src/lib/featureFlags/registry.ts
          </code>{' '}
          antes de aparecerem aqui.
        </p>
      </div>
    </AdminShell>
  );
}
