import { AdminShell } from '@/components/admin/AdminShell';
import { TrialSettingsForm } from '@/components/admin/settings/TrialSettingsForm';
import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';
import { getPlatformSettingsAction } from '@/lib/actions/admin/platform-settings';

export const metadata = { title: 'Axon Admin — Trial & Billing' };

export default async function TrialSettingsPage() {
  const admin = await requirePlatformAdmin();
  const result = await getPlatformSettingsAction();
  const settings = result.data ?? [];

  function intSetting(key: string, fallback: number): number {
    const s = settings.find((s) => s.key === key);
    if (s?.value.type === 'int') return s.value.value;
    return fallback;
  }

  return (
    <AdminShell admin={admin}>
      <div className="mr-auto flex max-w-page flex-col gap-6 pb-10">
        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">Trial & Billing</h2>
          <p className="text-text-secondary">
            Configurações de duração de trial e grace period de pagamento.
          </p>
        </div>

        <TrialSettingsForm
          trialDefaultDays={intSetting('trial_default_days', 14)}
          pastDueGraceDays={intSetting('past_due_grace_days', 7)}
          canMutate={admin.role === 'owner'}
        />
      </div>
    </AdminShell>
  );
}
