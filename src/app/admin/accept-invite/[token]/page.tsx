import Link from 'next/link';
import { AlertTriangle, MailQuestion, ShieldCheck } from 'lucide-react';

import { AcceptInviteFlow } from '@/components/admin/admins/AcceptInviteFlow';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { getInvitationByTokenAction } from '@/lib/actions/admin/platform-admins';

export const metadata = { title: 'Axon Admin — Aceitar convite' };

interface RouteParams {
  token: string;
}

export default async function AcceptInvitePage(props: {
  params: Promise<RouteParams>;
}) {
  const { token } = await props.params;
  const res = await getInvitationByTokenAction(token);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-base px-4 py-12">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:px-3 focus:py-2 focus:text-sm focus:text-text-primary focus:shadow-lg"
      >
        Pular para conteúdo
      </a>

      <main id="main" className="flex w-full max-w-md flex-col gap-8">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-action-primary shadow-lg">
            <ShieldCheck className="size-5 text-action-primary-fg" aria-hidden="true" />
          </div>
          <span className="text-xl font-bold tracking-tight text-text-primary">
            Axon Admin
          </span>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">
            Aceitar convite
          </h1>
          <p className="text-sm text-text-secondary">
            Você foi convidado a operar a plataforma Axon como administrador.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-surface-raised p-6 shadow-sm">
          {!res.success || !res.data ? (
            <InvalidInviteState
              title="Convite não encontrado"
              description={res.error ?? 'Verifique se o link foi copiado corretamente.'}
            />
          ) : res.data.status === 'expired' ? (
            <InvalidInviteState
              title="Convite expirado"
              description="Este link tinha validade de 72 horas e expirou. Peça um novo convite ao administrador que te convidou."
            />
          ) : res.data.status === 'consumed' ? (
            <InvalidInviteState
              title="Convite já utilizado"
              description="Este convite já foi aceito anteriormente. Acesse a área admin com sua conta."
              actionHref="/admin/login"
              actionLabel="Ir para login"
            />
          ) : res.data.status === 'revoked' ? (
            <InvalidInviteState
              title="Convite revogado"
              description="Este convite foi cancelado pelo administrador que o emitiu. Peça um novo se ainda precisar de acesso."
            />
          ) : (
            <AcceptInviteFlow
              email={res.data.email}
              role={res.data.role}
              token={token}
            />
          )}
        </div>
      </main>
    </div>
  );
}

interface InvalidStateProps {
  title:        string;
  description:  string;
  actionHref?:  string;
  actionLabel?: string;
}

function InvalidInviteState({
  title,
  description,
  actionHref,
  actionLabel,
}: InvalidStateProps) {
  return (
    <div className="flex flex-col gap-5">
      <Alert intent="warning" title={title}>
        {description}
      </Alert>
      <div className="flex flex-col gap-2 text-sm text-text-secondary">
        <p className="flex items-start gap-2">
          <MailQuestion className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Não recebeu o link correto? Entre em contato com quem te convidou para gerar
            um novo.
          </span>
        </p>
        <p className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Por segurança, convites expiram em 72 horas e só podem ser usados uma vez.
          </span>
        </p>
      </div>
      {actionHref && actionLabel && (
        <Button asChild variant="secondary">
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      )}
    </div>
  );
}
