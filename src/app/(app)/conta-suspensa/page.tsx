import { ShieldOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Conta suspensa — Axon CRM' };

async function handleSignOut() {
  'use server';
  const supabase = await createClient();
  await supabase.auth.signOut();
}

export default function ContaSuspensaPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-surface-base p-8 text-center">
      <div className="rounded-full bg-feedback-danger-bg border border-feedback-danger-border p-4">
        <ShieldOff className="size-10 text-feedback-danger-fg" aria-hidden="true" />
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-text-primary">Sua conta foi suspensa</h1>
        <p className="max-w-sm text-text-secondary">
          O acesso à plataforma foi temporariamente bloqueado. Para mais informações,
          entre em contato com o suporte Axon.
        </p>
      </div>

      <form action={handleSignOut}>
        <Button type="submit" variant="secondary">
          Sair da conta
        </Button>
      </form>
    </div>
  );
}
