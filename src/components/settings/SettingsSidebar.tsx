'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, User, Users } from 'lucide-react';

import type { SessionRole } from '@/lib/supabase/getSessionContext';
import { cn } from '@/lib/utils';

interface SettingsNavItem {
  href: string;
  label: string;
  icon: typeof User;
  roles?: readonly SessionRole[];
}

const items: SettingsNavItem[] = [
  { href: '/settings/profile', label: 'Meu perfil', icon: User },
  {
    href: '/settings/organization',
    label: 'Organização',
    icon: Building2,
    roles: ['owner', 'admin'],
  },
  {
    href: '/settings/team',
    label: 'Equipe',
    icon: Users,
    roles: ['owner', 'admin'],
  },
];

export function SettingsSidebar({ role }: { role: SessionRole }) {
  const pathname = usePathname();
  const visible = items.filter((it) => !it.roles || it.roles.includes(role));

  return (
    <nav aria-label="Configurações" className="flex flex-col gap-1">
      {visible.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:shadow-focus',
              active
                ? 'bg-action-primary/10 border border-action-primary/20 text-action-primary'
                : 'text-text-secondary hover:bg-surface-sunken hover:text-action-ghost-fg'
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
