import { LayoutDashboard } from 'lucide-react';
import Link from 'next/link';

export function AdminSidebar() {
  return (
    <aside className="hidden lg:flex flex-col w-56 shrink-0 border-r border-border bg-surface-raised h-full">
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-border">
        <div className="bg-action-primary rounded-lg size-8 flex items-center justify-center shrink-0">
          <LayoutDashboard className="size-4 text-action-primary-fg" />
        </div>
        <span className="font-bold text-text-primary text-sm tracking-tight">Axon Admin</span>
      </div>
      <nav className="flex-1 p-3 space-y-0.5">
        <Link
          href="/admin/dashboard"
          className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-text-secondary hover:bg-surface-sunken hover:text-text-primary transition-colors"
        >
          <LayoutDashboard className="size-4" />
          Dashboard
        </Link>
        {/* Navigation items will be added by sprints 05+ */}
      </nav>
    </aside>
  );
}
