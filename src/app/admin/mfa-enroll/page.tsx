import { Shield } from 'lucide-react';

import { AdminMfaEnrollForm } from '@/components/admin/AdminMfaEnrollForm';

export const metadata = { title: 'Axon Admin — Configurar MFA' };

export default function AdminMfaEnrollPage() {
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
            Configure a autenticação em 2 fatores
          </h2>
          <p className="text-text-secondary text-sm">
            MFA é obrigatório para acesso à área administrativa.
          </p>
        </div>

        <div className="bg-surface-raised rounded-xl border border-border p-6 shadow-sm">
          <AdminMfaEnrollForm />
        </div>
      </div>
    </div>
  );
}
