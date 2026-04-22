'use client';

import { useTransition } from 'react';
import { Bell, LogOut, Settings } from 'lucide-react';

import type { SessionContext } from '@/lib/supabase/getSessionContext';
import { logoutAction } from '@/lib/actions/auth';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { GlobalSearch } from '@/components/layout/GlobalSearch';

interface TopbarProps {
  session: SessionContext;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const ROLE_LABEL: Record<SessionContext['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Membro',
};

export function Topbar({ session }: TopbarProps) {
  const [isPending, startTransition] = useTransition();
  const initials = getInitials(session.fullName);

  const handleLogout = () => {
    startTransition(() => {
      void logoutAction();
    });
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-surface-raised/80 px-6 backdrop-blur-md">
      <div className="hidden max-w-md flex-1 sm:flex">
        <GlobalSearch />
      </div>

      <div className="ml-4 flex items-center gap-4">
        <button
          type="button"
          aria-label="Notificações"
          className="relative rounded-lg p-2 text-text-secondary transition-colors hover:bg-surface-sunken hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
        >
          <Bell className="size-5" aria-hidden="true" />
          <span className="absolute right-2 top-2 size-2 rounded-full border-2 border-surface-raised bg-feedback-danger-solid-bg" />
        </button>
        <ThemeToggle />
        <button
          type="button"
          aria-label="Configurações"
          className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-surface-sunken hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
        >
          <Settings className="size-5" aria-hidden="true" />
        </button>
        <div className="mx-2 h-8 w-px bg-border" aria-hidden="true" />
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium text-text-primary">{session.fullName || 'Usuário'}</p>
            <p className="text-xs text-text-secondary">{ROLE_LABEL[session.role]}</p>
          </div>
          <div className="flex size-9 items-center justify-center rounded-full bg-action-primary text-sm font-bold text-action-primary-fg shadow-sm">
            {initials}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={isPending}
            aria-label="Sair"
            className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-surface-sunken hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-50"
          >
            <LogOut className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
