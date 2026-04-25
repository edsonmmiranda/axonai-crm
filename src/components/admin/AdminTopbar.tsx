import { Bell, Menu, Search, Settings } from 'lucide-react';

import type { PlatformAdminRole, PlatformAdminSnapshot } from '@/lib/auth/platformAdmin';

const ROLE_LABEL: Record<PlatformAdminRole, string> = {
  owner: 'Owner',
  support: 'Suporte',
  billing: 'Faturamento',
};

function getInitials(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (local.slice(0, 2) || '??').toUpperCase();
}

interface Props {
  admin: PlatformAdminSnapshot;
}

export function AdminTopbar({ admin }: Props) {
  const initials = getInitials(admin.email);

  return (
    <header className="h-16 flex items-center justify-between px-6 border-b border-border bg-surface-raised/80 backdrop-blur-md sticky top-0 z-20">
      <button
        type="button"
        aria-label="Abrir menu"
        className="md:hidden text-text-primary mr-4 focus-visible:outline-none focus-visible:shadow-focus rounded-md"
      >
        <Menu className="size-6" />
      </button>

      <div className="flex-1 max-w-md hidden sm:flex">
        <div className="relative w-full group">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="size-5 text-text-secondary group-focus-within:text-action-primary transition-colors" />
          </div>
          <input
            type="text"
            placeholder="Buscar organizations, plans..."
            className="block w-full pl-10 pr-3 py-2 border border-field-border rounded-lg leading-5 bg-field text-field-fg placeholder:text-field-placeholder focus:outline-none focus:ring-1 focus:ring-field-border-focus focus:border-field-border-focus focus:bg-surface-raised text-sm transition-all shadow-sm"
          />
        </div>
      </div>

      <div className="flex items-center gap-4 ml-4">
        <button
          type="button"
          aria-label="Notificações"
          className="relative p-2 text-text-secondary hover:text-action-ghost-fg transition-colors rounded-lg hover:bg-surface-sunken focus-visible:outline-none focus-visible:shadow-focus"
        >
          <Bell className="size-5" />
        </button>
        <button
          type="button"
          aria-label="Configurações"
          className="p-2 text-text-secondary hover:text-action-ghost-fg transition-colors rounded-lg hover:bg-surface-sunken focus-visible:outline-none focus-visible:shadow-focus"
        >
          <Settings className="size-5" />
        </button>
        <div className="h-8 w-px bg-border mx-2" />
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-text-primary leading-none">{admin.email}</p>
            <p className="text-xs text-text-secondary mt-0.5">{ROLE_LABEL[admin.role]}</p>
          </div>
          <div className="size-9 rounded-full bg-action-primary flex items-center justify-center text-action-primary-fg font-bold text-sm shadow-sm">
            {initials}
          </div>
        </div>
      </div>
    </header>
  );
}
