import Link from 'next/link';
import { Mail } from 'lucide-react';

import { AuthCard } from '@/components/auth/AuthCard';
import { Alert } from '@/components/ui/alert';

export const metadata = { title: 'Verifique seu email — Axon AI CRM' };

interface PageProps {
  searchParams: Promise<{ email?: string }>;
}

export default async function CheckEmailPage({ searchParams }: PageProps) {
  const { email } = await searchParams;

  return (
    <AuthCard
      title="Verifique seu email"
      description="Falta só um passo para ativar sua conta."
      footer={
        <>
          Já ativou a conta?{' '}
          <Link href="/login" className="font-medium text-action-primary hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-action-primary/10">
            <Mail className="size-6 text-action-primary" aria-hidden="true" />
          </div>
          <p className="text-sm text-text-secondary">
            Enviamos um link de ativação
            {email ? (
              <>
                {' '}para <strong className="text-text-primary break-all">{email}</strong>
              </>
            ) : (
              <> para o seu email</>
            )}
            . Abra o email e clique no link para ativar sua conta.
          </p>
        </div>

        <Alert intent="info">
          Depois de ativar, volte aqui e faça login com seu email e senha.
        </Alert>

        <p className="text-xs text-center text-text-secondary">
          Não recebeu? Verifique sua caixa de spam ou aguarde alguns minutos.
        </p>
      </div>
    </AuthCard>
  );
}
