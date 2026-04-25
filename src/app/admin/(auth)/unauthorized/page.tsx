import { ShieldOff } from 'lucide-react';

export const metadata = { title: 'Axon Admin — Acesso negado' };

export default function AdminUnauthorizedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-base px-4 py-12">
      <div className="w-full max-w-md text-center flex flex-col items-center gap-6">
        <div className="bg-feedback-danger-bg rounded-full size-16 flex items-center justify-center border border-feedback-danger-border">
          <ShieldOff className="size-8 text-feedback-danger-fg" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-text-primary tracking-tight">Acesso negado</h2>
          <p className="text-text-secondary text-sm leading-relaxed">
            Seu perfil não tem acesso à área administrativa.
            Contate um platform admin owner para obter permissão.
          </p>
        </div>
      </div>
    </div>
  );
}
