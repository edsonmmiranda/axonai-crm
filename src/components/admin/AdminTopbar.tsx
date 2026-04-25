'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';
import type { PlatformAdminRole } from '@/lib/auth/platformAdmin';

const ROLE_LABEL: Record<PlatformAdminRole, string> = {
  owner: 'Owner',
  support: 'Suporte',
  billing: 'Faturamento',
};

interface Props {
  adminName: string;
  adminRole: PlatformAdminRole;
}

export function AdminTopbar({ adminName, adminRole }: Props) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/admin/login');
    router.refresh();
  }

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-raised shrink-0">
      <div className="lg:hidden flex items-center gap-2">
        <span className="font-bold text-text-primary text-sm">Axon Admin</span>
      </div>
      <div className="hidden lg:block" />
      <div className="flex items-center gap-3">
        <div className="text-right hidden sm:block">
          <p className="text-sm font-medium text-text-primary leading-none">{adminName}</p>
          <p className="text-xs text-text-muted mt-0.5">{ROLE_LABEL[adminRole]}</p>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:shadow-focus rounded-md px-2 py-1"
          type="button"
          aria-label="Sair"
        >
          <LogOut className="size-4" />
          <span className="hidden sm:inline">Sair</span>
        </button>
      </div>
    </header>
  );
}
