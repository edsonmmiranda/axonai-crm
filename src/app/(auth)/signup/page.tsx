import Link from 'next/link';

import { AuthCard } from '@/components/auth/AuthCard';
import { SignupForm } from '@/components/auth/SignupForm';

export const metadata = { title: 'Criar conta — Axon AI CRM' };

export default function SignupPage() {
  return (
    <AuthCard
      title="Criar conta"
      description="Crie sua organização e comece a usar o CRM."
      footer={
        <>
          Já tem conta?{' '}
          <Link href="/login" className="font-medium text-action-primary hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthCard>
  );
}
