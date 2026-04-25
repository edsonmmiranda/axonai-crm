import { Shield } from 'lucide-react';

import { AdminLoginForm } from '@/components/admin/AdminLoginForm';

export const metadata = { title: 'Axon Admin — Acesso' };

export default function AdminLoginPage() {
  return (
    <div className="flex h-screen w-full overflow-hidden">

      {/* ── Branding panel (left — hidden on mobile) ── */}
      <aside className="hidden lg:flex w-1/2 h-full relative bg-surface-inverse overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-surface-inverse via-surface-inverse to-surface-inverse/80" />
        <div className="relative z-10 flex flex-col justify-between h-full w-full p-12 xl:p-16">
          {/* Logo */}
          <div className="flex items-center gap-3 text-text-inverse/90">
            <div className="bg-action-primary rounded-xl size-10 shadow-lg flex items-center justify-center">
              <Shield className="size-5 text-action-primary-fg" />
            </div>
            <span className="text-xl font-bold tracking-tight text-text-inverse">Axon Admin</span>
          </div>

          {/* Copy */}
          <div className="flex flex-col gap-8">
            <div className="space-y-4 max-w-lg">
              <span className="inline-block px-3 py-1 rounded-full bg-surface-raised/10 backdrop-blur-md border border-surface-raised/20 text-text-inverse text-xs font-bold uppercase tracking-wider">
                Área Restrita
              </span>
              <h1 className="text-4xl xl:text-5xl font-bold text-text-inverse leading-tight">
                Painel administrativo da Axon AI.
              </h1>
              <p className="text-lg text-text-inverse/80 leading-relaxed font-light">
                Acesso exclusivo para operadores da plataforma. Autenticação em dois fatores obrigatória.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-4 border-t border-surface-raised/10">
              <Shield className="size-5 text-text-inverse/60" />
              <span className="text-sm text-text-inverse/70">
                Sessão expira em 8h de inatividade · 12h absoluto
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Form panel (right) ── */}
      <section className="w-full lg:w-1/2 h-full bg-surface-raised flex flex-col overflow-y-auto">
        <div className="flex-1 flex flex-col justify-center items-center px-6 py-12 sm:px-12 xl:px-24">
          <div className="w-full max-w-md flex flex-col gap-8">

            {/* Mobile logo */}
            <div className="flex lg:hidden items-center gap-3 mb-2">
              <div className="bg-action-primary rounded-xl size-10 shadow-lg flex items-center justify-center">
                <Shield className="size-5 text-action-primary-fg" />
              </div>
              <span className="text-xl font-bold tracking-tight text-text-primary">Axon Admin</span>
            </div>

            <div className="text-left space-y-2">
              <h2 className="text-3xl font-bold text-text-primary tracking-tight">
                Acesso Administrativo
              </h2>
              <p className="text-text-secondary">
                Restrito a operadores autorizados. MFA obrigatório.
              </p>
            </div>

            <AdminLoginForm />
          </div>
        </div>

        <footer className="py-6 border-t border-border flex flex-col items-center gap-2 text-center px-8 bg-surface-sunken/50">
          <p className="text-xs text-text-secondary">
            © 2026 Axon AI. Todos os direitos reservados.
          </p>
          <p className="text-xs text-text-muted">Área restrita a operadores da plataforma.</p>
        </footer>
      </section>
    </div>
  );
}
