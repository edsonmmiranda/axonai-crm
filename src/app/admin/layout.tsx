import type { ReactNode } from 'react';

import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { getPlatformAdmin, type AdminThemePreference } from '@/lib/auth/platformAdmin';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await getPlatformAdmin();
  const initialTheme: AdminThemePreference = admin?.adminTheme ?? 'light';

  return (
    <ThemeProvider initialTheme={initialTheme} storageKey="admin-theme">
      <div
        data-admin
        className="min-h-screen bg-surface-base text-text-primary font-sans antialiased"
      >
        {children}
      </div>
    </ThemeProvider>
  );
}
