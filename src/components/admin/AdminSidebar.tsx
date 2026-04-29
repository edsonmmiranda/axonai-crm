'use client';

import { Building2, CreditCard, Flag, Gavel, History, LayoutDashboard, LogOut, Mail, Settings, Timer, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

interface NavItem {
  href: string;
  label: string;
  Icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/admin/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/admin/organizations', label: 'Organizations', Icon: Building2 },
  { href: '/admin/plans', label: 'Plans', Icon: CreditCard },
  { href: '/admin/admins', label: 'Administradores', Icon: Users },
  { href: '/admin/audit', label: 'Audit log', Icon: History },
];

const SETTINGS_ITEMS: NavItem[] = [
  { href: '/admin/settings/feature-flags', label: 'Feature flags', Icon: Flag },
  { href: '/admin/settings/trial', label: 'Trial & billing', Icon: Timer },
  { href: '/admin/settings/legal', label: 'Políticas legais', Icon: Gavel },
  { href: '/admin/settings/integrations/email', label: 'Integrações · Email', Icon: Mail },
];

const NAV_BASE =
  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:shadow-focus';
const NAV_INACTIVE =
  'text-text-secondary hover:bg-surface-sunken hover:text-action-ghost-fg';
const NAV_ACTIVE =
  'bg-action-primary/10 border border-action-primary/20 text-action-primary hover:bg-action-primary/20';

export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  function isActive(href: string): boolean {
    if (href === '/admin/dashboard') return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/admin/login');
    router.refresh();
  }

  return (
    <aside className="hidden md:flex flex-col w-64 h-full border-r border-border bg-surface-raised flex-shrink-0 z-30 shadow-sm">
      <div className="p-6 pb-2">
        <div className="flex gap-3 items-center">
          <div className="bg-action-primary rounded-xl size-10 shadow-lg flex items-center justify-center">
            <LayoutDashboard className="size-5 text-action-primary-fg" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-text-primary text-base font-bold leading-tight tracking-tight">
              Axon Admin
            </h1>
            <p className="text-text-secondary text-xs font-normal">Plataforma</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 flex flex-col gap-2 px-4 py-6 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(NAV_BASE, isActive(href) ? NAV_ACTIVE : NAV_INACTIVE)}
          >
            <Icon className="size-5" />
            <p className="text-sm font-medium">{label}</p>
          </Link>
        ))}

        {/* Configurações */}
        <div className="mt-4 flex flex-col gap-1">
          <div className="flex items-center gap-2 px-3 py-1.5">
            <Settings className="size-3.5 text-text-muted" />
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Configurações</p>
          </div>
          {SETTINGS_ITEMS.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(NAV_BASE, isActive(href) ? NAV_ACTIVE : NAV_INACTIVE)}
            >
              <Icon className="size-5" />
              <p className="text-sm font-medium">{label}</p>
            </Link>
          ))}
        </div>
      </nav>

      <div className="p-4 border-t border-border">
        <button
          type="button"
          onClick={handleSignOut}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-surface-sunken transition-colors text-left group focus-visible:outline-none focus-visible:shadow-focus"
          aria-label="Sair"
        >
          <LogOut className="size-5 text-text-secondary group-hover:text-action-ghost-fg" />
          <span className="text-text-secondary text-sm font-medium group-hover:text-action-ghost-fg">
            Sair
          </span>
        </button>
      </div>
    </aside>
  );
}
