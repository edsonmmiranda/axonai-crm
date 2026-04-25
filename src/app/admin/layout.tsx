import type { ReactNode } from 'react';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-admin
      className="min-h-screen bg-surface-base text-text-primary font-sans antialiased"
    >
      {children}
    </div>
  );
}
