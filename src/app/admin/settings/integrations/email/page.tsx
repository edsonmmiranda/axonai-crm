import { AdminShell } from '@/components/admin/AdminShell';
import { IntegrationCredentialStatusCard } from '@/components/admin/settings/integrations/IntegrationCredentialStatusCard';
import { IntegrationCredentialForm } from '@/components/admin/settings/integrations/IntegrationCredentialForm';
import { RevokeCredentialDialog } from '@/components/admin/settings/integrations/RevokeCredentialDialog';
import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';
import { listIntegrationCredentialsAction } from '@/lib/actions/admin/integration-credentials';
import { getEmailSourceStatus } from '@/lib/email/getEmailSourceStatus';

export const metadata = { title: 'Axon Admin — Integrações de Email' };

export default async function EmailIntegrationPage() {
  const admin = await requirePlatformAdmin();
  const [credentialsResult, status] = await Promise.all([
    listIntegrationCredentialsAction(),
    getEmailSourceStatus(),
  ]);

  const credentials = credentialsResult.success ? (credentialsResult.data ?? []) : [];
  const active = credentials.find((c) => c.kind === 'email_smtp' && c.revokedAt === null) ?? null;
  const canMutate = admin.role === 'owner';

  return (
    <AdminShell admin={admin}>
      <div className="mr-auto flex max-w-page flex-col gap-6 pb-10">
        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">Integrações · Email</h2>
          <p className="text-text-secondary">
            Configure o SMTP transacional usado por convites e resets administrativos. A senha é
            cifrada no Supabase Vault e nunca retorna para a interface.
          </p>
        </div>

        {!credentialsResult.success && (
          <div className="rounded-xl border border-feedback-danger-border bg-feedback-danger-bg p-4 text-sm text-feedback-danger-fg">
            Erro ao carregar credenciais: {credentialsResult.error ?? 'Erro interno.'}
          </div>
        )}

        <IntegrationCredentialStatusCard credential={active} status={status} />

        <IntegrationCredentialForm existing={active} canMutate={canMutate} />

        {canMutate && active && (
          <div className="flex flex-col gap-3 rounded-xl border border-feedback-danger-border bg-feedback-danger-bg p-6">
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-semibold text-feedback-danger-fg">Zona de risco</h3>
              <p className="text-sm text-feedback-danger-fg">
                Revogar a credencial força envios futuros a caírem para env vars ou fallback offline.
                A operação é irreversível e fica registrada no audit log.
              </p>
            </div>
            <div>
              <RevokeCredentialDialog credential={active} />
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
