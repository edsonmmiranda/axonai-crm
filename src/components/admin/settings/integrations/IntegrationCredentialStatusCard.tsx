import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { IntegrationCredentialView } from '@/lib/actions/admin/integration-credentials.schemas';
import type { EmailSourceStatus } from '@/lib/email/getEmailSourceStatus';

interface Props {
  credential: IntegrationCredentialView | null;
  status:     EmailSourceStatus;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'nunca';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return 'agora mesmo';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `há ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `há ${months} ${months === 1 ? 'mês' : 'meses'}`;
  const years = Math.floor(months / 12);
  return `há ${years} ${years === 1 ? 'ano' : 'anos'}`;
}

export function IntegrationCredentialStatusCard({ credential, status }: Props) {
  let badge: { label: string; variant: 'role-owner' | 'status-pending' | 'status-inactive' };
  if (credential) {
    badge = { label: 'Configurado', variant: 'role-owner' };
  } else if (status.envVar) {
    badge = { label: 'Usando env vars', variant: 'status-pending' };
  } else {
    badge = { label: 'Não configurado', variant: 'status-inactive' };
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Status do envio de email</CardTitle>
            <CardDescription>
              Fonte ativa que será usada por convites e resets administrativos.
            </CardDescription>
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </CardHeader>

      <CardContent>
        {credential ? (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <dt className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Última utilização
              </dt>
              <dd className="text-sm text-text-primary">
                {formatRelativeTime(credential.lastUsedAt)}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Rotacionada
              </dt>
              <dd className="text-sm text-text-primary">
                {credential.rotatedAt ? formatRelativeTime(credential.rotatedAt) : 'nunca'}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Hint
              </dt>
              <dd className="text-sm font-mono text-text-primary">
                {credential.hint ?? '—'}
              </dd>
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Label
              </dt>
              <dd className="text-sm text-text-primary">{credential.label}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Cadastrada
              </dt>
              <dd className="text-sm text-text-primary">
                {formatRelativeTime(credential.createdAt)}
              </dd>
            </div>
          </dl>
        ) : status.envVar ? (
          <p className="text-sm text-text-secondary">
            Usando credenciais definidas em <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-xs">BOOTSTRAP_EMAIL_*</code>.
            Cadastrar credencial pela UI substituirá a fonte para envios futuros.
          </p>
        ) : status.offlineFallback ? (
          <p className="text-sm text-text-secondary">
            Email não configurado. Convites e resets gerarão link copiável até que uma fonte seja cadastrada.
          </p>
        ) : (
          <p className="text-sm text-feedback-danger-fg">
            Email não configurado e fallback offline desativado. Convites e resets vão falhar até que uma credencial seja cadastrada.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
