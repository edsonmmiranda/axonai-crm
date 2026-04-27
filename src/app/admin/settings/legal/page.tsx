import { AdminShell } from '@/components/admin/AdminShell';
import { LegalPoliciesView } from '@/components/admin/settings/LegalPoliciesView';
import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';
import { getActiveLegalPoliciesAction } from '@/lib/actions/admin/legal-policies';

export const metadata = { title: 'Axon Admin — Políticas Legais' };

export default async function LegalPoliciesPage() {
  const admin = await requirePlatformAdmin();
  const result = await getActiveLegalPoliciesAction();
  const policies = result.success ? (result.data ?? []) : [];

  return (
    <AdminShell admin={admin}>
      <div className="mr-auto flex max-w-page flex-col gap-6 pb-10">
        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">Políticas Legais</h2>
          <p className="text-text-secondary">
            Versione Termos de Uso, Privacidade e demais políticas. Cada versão é imutável após criação.
          </p>
        </div>

        {!result.success && (
          <div className="rounded-xl border border-feedback-danger-border bg-feedback-danger-bg p-4 text-sm text-feedback-danger-fg">
            Erro ao carregar políticas legais.
          </div>
        )}

        <LegalPoliciesView policies={policies} canMutate={admin.role === 'owner'} />
      </div>
    </AdminShell>
  );
}
