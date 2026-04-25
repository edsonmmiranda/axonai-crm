import { Shield } from 'lucide-react';

import { AdminMfaChallengeForm } from '@/components/admin/AdminMfaChallengeForm';

export const metadata = { title: 'Axon Admin — Verificação MFA' };

export default function AdminMfaChallengePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-base px-4 py-12">
      <div className="w-full max-w-md flex flex-col gap-8">
        <div className="flex items-center gap-3">
          <div className="bg-action-primary rounded-xl size-10 shadow-lg flex items-center justify-center shrink-0">
            <Shield className="size-5 text-action-primary-fg" />
          </div>
          <span className="text-xl font-bold tracking-tight text-text-primary">Axon Admin</span>
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-text-primary tracking-tight">
            Verificação em 2 etapas
          </h2>
          <p className="text-text-secondary text-sm">
            Digite o código do seu app autenticador para continuar.
          </p>
        </div>

        <div className="bg-surface-raised rounded-xl border border-border p-6 shadow-sm">
          <AdminMfaChallengeForm />
        </div>
      </div>
    </div>
  );
}
