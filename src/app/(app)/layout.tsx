import type { ReactNode } from 'react';

import AppLayout from '@/components/layout/AppLayout';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const session = await getSessionContext();
  return (
    <ThemeProvider initialTheme={session.themePreference}>
      <AppLayout session={session}>{children}</AppLayout>
    </ThemeProvider>
  );
}
