import Link from 'next/link';

import { AuthCard } from '@/components/auth/AuthCard';
import { AcceptInviteForm } from '@/components/auth/AcceptInviteForm';
import { Alert } from '@/components/ui/alert';
import { createServiceClient } from '@/lib/supabase/service';

export const metadata = { title: 'Aceitar convite — Axon AI CRM' };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageProps {
  params: Promise<{ token: string }>;
}

type InviteStatus =
  | { kind: 'invalid' }
  | { kind: 'used' }
  | { kind: 'expired' }
  | { kind: 'ok'; email: string; organizationName: string };

async function loadInvite(token: string): Promise<InviteStatus> {
  if (!UUID_REGEX.test(token)) return { kind: 'invalid' };
  const service = createServiceClient();
  const { data: invite, error } = await service
    .from('invitations')
    .select('email, organization_id, expires_at, accepted_at, organizations(name)')
    .eq('token', token)
    .single<{
      email: string;
      organization_id: string;
      expires_at: string;
      accepted_at: string | null;
      organizations: { name: string } | { name: string }[] | null;
    }>();

  if (error || !invite) return { kind: 'invalid' };
  if (invite.accepted_at) return { kind: 'used' };
  if (new Date(invite.expires_at) <= new Date()) return { kind: 'expired' };

  const orgRel = invite.organizations;
  const organizationName = Array.isArray(orgRel) ? (orgRel[0]?.name ?? '') : (orgRel?.name ?? '');
  return { kind: 'ok', email: invite.email, organizationName };
}

export default async function AcceptInvitePage({ params }: PageProps) {
  const { token } = await params;
  const status = await loadInvite(token);

  if (status.kind !== 'ok') {
    const message =
      status.kind === 'used'
        ? 'Este convite já foi usado. Faça login.'
        : status.kind === 'expired'
          ? 'Este convite expirou. Peça um novo ao admin.'
          : 'Convite inválido.';
    return (
      <AuthCard
        title="Convite"
        footer={
          <Link href="/login" className="font-medium text-action-primary hover:underline">
            Ir para login
          </Link>
        }
      >
        <Alert intent="danger" role="alert">
          {message}
        </Alert>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Aceitar convite" description="Defina sua senha para entrar no time.">
      <AcceptInviteForm
        inviteToken={token}
        email={status.email}
        organizationName={status.organizationName}
      />
    </AuthCard>
  );
}
