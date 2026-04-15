import Link from 'next/link';
import { Suspense } from 'react';

import { AuthCard } from '@/components/auth/AuthCard';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata = { title: 'Entrar — Axon AI CRM' };

export default function LoginPage() {
  return (
    <AuthCard
      title="Entrar"
      description="Acesse sua conta com email e senha ou receba um link."
      footer={
        <>
          Ainda não tem conta?{' '}
          <Link href="/signup" className="font-medium text-action-primary hover:underline">
            Criar conta
          </Link>
        </>
      }
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthCard>
  );
}
