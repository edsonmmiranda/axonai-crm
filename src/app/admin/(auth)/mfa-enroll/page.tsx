import { Shield, ShieldAlert } from 'lucide-react';

import { AdminMfaEnrollForm, type MfaEnrollMode } from '@/components/admin/AdminMfaEnrollForm';
import { Alert } from '@/components/ui/alert';

export const metadata = { title: 'Axon Admin — Configurar MFA' };

interface SearchParams {
  reenroll?:    string;
  firstEnroll?: string;
}

export default async function AdminMfaEnrollPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await props.searchParams;

  let mode: MfaEnrollMode = 'standard';
  if (sp.reenroll === 'true')         mode = 'reenroll';
  else if (sp.firstEnroll === 'true') mode = 'first';

  const heading =
    mode === 'reenroll' ? 'Reconfigurar autenticação em 2 fatores'
    : mode === 'first'   ? 'Configure MFA para entrar na área admin'
    :                      'Configure a autenticação em 2 fatores';

  const subheading =
    mode === 'reenroll' ? 'Sua sessão exige reconfiguração de MFA antes de continuar.'
    : mode === 'first'   ? 'Bem-vindo! Configure seu app autenticador para finalizar o aceite do convite.'
    :                      'MFA é obrigatório para acesso à área administrativa.';

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-base px-4 py-12">
      <div className="w-full max-w-md flex flex-col gap-8">
        <div className="flex items-center gap-3">
          <div className="bg-action-primary rounded-xl size-10 shadow-lg flex items-center justify-center shrink-0">
            <Shield className="size-5 text-action-primary-fg" />
          </div>
          <span className="text-xl font-bold tracking-tight text-text-primary">Axon Admin</span>
        </div>

        {mode === 'reenroll' && (
          <Alert intent="warning" title="Reset de MFA pendente">
            <p className="flex items-start gap-1.5">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                O TOTP atual foi invalidado (após password reset ou aprovação de step-up).
                Configure um novo factor abaixo para liberar acesso à área admin.
              </span>
            </p>
          </Alert>
        )}

        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-text-primary tracking-tight">
            {heading}
          </h2>
          <p className="text-text-secondary text-sm">
            {subheading}
          </p>
        </div>

        <div className="bg-surface-raised rounded-xl border border-border p-6 shadow-sm">
          <AdminMfaEnrollForm mode={mode} />
        </div>
      </div>
    </div>
  );
}
