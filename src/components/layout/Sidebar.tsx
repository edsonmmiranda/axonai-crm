'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Building2,
  Kanban,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Package,
  Settings,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { logoutAction } from '@/lib/actions/auth';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

const primaryNav: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/products', label: 'Produtos', icon: Package },
  { href: '#', label: 'Leads', icon: Users },
  { href: '#', label: 'Pipeline', icon: Kanban },
  { href: '#', label: 'WhatsApp', icon: MessageCircle, badge: '3' },
];

const secondarySections: NavSection[] = [
  {
    title: 'Relatórios',
    items: [
      { href: '#', label: 'Desempenho', icon: BarChart3 },
      { href: '#', label: 'Conversão', icon: TrendingUp },
    ],
  },
];

const footerItems: NavItem[] = [
  { href: '/settings/profile', label: 'Configurações', icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '#') return false;
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname.startsWith(href);
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
        'focus-visible:outline-none focus-visible:shadow-focus',
        active
          ? 'bg-action-primary/10 border border-action-primary/20 text-action-primary'
          : 'text-text-secondary hover:bg-surface-sunken hover:text-action-ghost-fg',
      )}
    >
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      <span className="flex flex-1 items-center justify-between">
        <span className="text-sm font-medium">{item.label}</span>
        {item.badge && (
          <span className="rounded-full bg-feedback-success-solid-bg px-1.5 py-0.5 text-xs font-bold text-feedback-success-solid-fg">
            {item.badge}
          </span>
        )}
      </span>
    </Link>
  );
}

interface SidebarProps {
  organizationName: string;
}

export function Sidebar({ organizationName }: SidebarProps) {
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const handleLogout = () => {
    startTransition(() => {
      void logoutAction();
    });
  };

  return (
    <aside className="z-30 hidden h-full w-64 shrink-0 flex-col border-r border-border bg-surface-raised shadow-sm md:flex">
      <div className="p-6 pb-2">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-action-primary shadow-lg">
            <Building2 className="size-5 text-action-primary-fg" aria-hidden="true" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-base font-bold leading-tight tracking-tight text-text-primary">
              {organizationName || 'Axon AI CRM'}
            </h1>
            <p className="text-xs text-text-secondary">Gestão de Vendas</p>
          </div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-6">
        {primaryNav.map((item) => (
          <NavLink key={item.label} item={item} active={isActive(pathname, item.href)} />
        ))}

        {secondarySections.map((section) => (
          <div key={section.title} className="mt-4 border-t border-border pt-4">
            {section.title && (
              <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {section.title}
              </p>
            )}
            {section.items.map((item) => (
              <NavLink key={item.label} item={item} active={isActive(pathname, item.href)} />
            ))}
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-1 border-t border-border p-4">
        {footerItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:shadow-focus"
            >
              <Icon
                className="size-5 text-text-secondary group-hover:text-action-ghost-fg"
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-text-secondary group-hover:text-action-ghost-fg">
                {item.label}
              </span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={handleLogout}
          disabled={isPending}
          className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-50"
        >
          <LogOut
            className="size-5 text-text-secondary group-hover:text-action-ghost-fg"
            aria-hidden="true"
          />
          <span className="text-sm font-medium text-text-secondary group-hover:text-action-ghost-fg">
            Sair
          </span>
        </button>
      </div>
    </aside>
  );
}
