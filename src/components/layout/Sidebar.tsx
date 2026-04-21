'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  BarChart3,
  Building2,
  ChevronDown,
  GitBranch,
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

type ParamsReader = { get(key: string): string | null };

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  children?: NavChild[];
}

interface NavChild {
  href: string;
  label: string;
  match?: (pathname: string, params: ParamsReader) => boolean;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

interface FunnelOption {
  id: string;
  name: string;
}

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

function defaultChildMatch(pathname: string, href: string): boolean {
  if (href === '/leads') return pathname === '/leads';
  return pathname.startsWith(href);
}

function isChildActive(
  pathname: string,
  params: ParamsReader,
  child: NavChild,
): boolean {
  if (child.match) return child.match(pathname, params);
  return defaultChildMatch(pathname, child.href);
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

function NavItemWithChildren({
  item,
  pathname,
  params,
}: {
  item: NavItem;
  pathname: string;
  params: ParamsReader;
}) {
  const Icon = item.icon;
  const hasActiveChild =
    item.children?.some((c) => isChildActive(pathname, params, c)) ?? false;
  const [open, setOpen] = useState(hasActiveChild);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
          'focus-visible:outline-none focus-visible:shadow-focus',
          hasActiveChild
            ? 'bg-action-primary/10 border border-action-primary/20 text-action-primary'
            : 'text-text-secondary hover:bg-surface-sunken hover:text-action-ghost-fg',
        )}
      >
        <Icon className="size-5 shrink-0" aria-hidden="true" />
        <span className="flex flex-1 items-center justify-between">
          <span className="text-sm font-medium">{item.label}</span>
          <ChevronDown
            className={cn('size-4 transition-transform', open && 'rotate-180')}
            aria-hidden="true"
          />
        </span>
      </button>
      {open && item.children && (
        <div className="mt-1 ml-5 flex flex-col gap-0.5 border-l border-border-subtle pl-3">
          {item.children.map((child) => {
            const active = isChildActive(pathname, params, child);
            return (
              <Link
                key={child.href}
                href={child.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-3 py-1.5 text-sm transition-colors',
                  'focus-visible:outline-none focus-visible:shadow-focus',
                  active
                    ? 'font-medium text-action-primary bg-action-primary/5'
                    : 'text-text-secondary hover:text-action-ghost-fg hover:bg-surface-sunken',
                )}
              >
                {child.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface SidebarProps {
  organizationName: string;
  funnels: FunnelOption[];
}

export function Sidebar({ organizationName, funnels }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const primaryNav = useMemo<NavItem[]>(() => {
    const pipelineChildren: NavChild[] = funnels.map((f, i) => ({
      href: `/pipeline?funnel=${f.id}`,
      label: f.name,
      match: (p, params) => {
        if (!p.startsWith('/pipeline')) return false;
        const current = params.get('funnel');
        if (current) return current === f.id;
        return i === 0;
      },
    }));

    const pipelineItem: NavItem =
      pipelineChildren.length > 0
        ? {
            href: '/pipeline',
            label: 'Pipeline',
            icon: Kanban,
            children: pipelineChildren,
          }
        : { href: '/pipeline', label: 'Pipeline', icon: Kanban };

    return [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/products', label: 'Produtos', icon: Package },
      {
        href: '/leads',
        label: 'Leads',
        icon: Users,
        children: [
          { href: '/leads', label: 'Todos os Leads' },
          { href: '/leads-origins', label: 'Origens' },
          { href: '/leads-tags', label: 'Tags' },
          { href: '/leads-loss-reasons', label: 'Motivos de Perda' },
        ],
      },
      { href: '/funnels', label: 'Funis', icon: GitBranch },
      pipelineItem,
      { href: '#', label: 'WhatsApp', icon: MessageCircle, badge: '3' },
    ];
  }, [funnels]);

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
        {primaryNav.map((item) =>
          item.children ? (
            <NavItemWithChildren
              key={item.label}
              item={item}
              pathname={pathname}
              params={searchParams}
            />
          ) : (
            <NavLink key={item.label} item={item} active={isActive(pathname, item.href)} />
          ),
        )}

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
