import Link from 'next/link';

import { AuthCard } from '@/components/auth/AuthCard';
import { ResendConfirmationForm } from '@/components/auth/ResendConfirmationForm';

export const metadata = { title: 'Link expirado — Axon AI CRM' };

export default function LinkExpiredPage() {
  return (
    <AuthCard
      title="Link expirado"
      description="O link de ativação que você usou é inválido ou expirou. Informe seu email abaixo e enviaremos um novo."
      footer={
        <>
          Lembrou a senha?{' '}
          <Link href="/login" className="font-medium text-action-primary hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <ResendConfirmationForm />
    </AuthCard>
  );
}
