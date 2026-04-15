import type { ReactNode } from 'react';

import AppLayout from '@/components/layout/AppLayout';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const session = await getSessionContext();
  return <AppLayout session={session}>{children}</AppLayout>;
}
