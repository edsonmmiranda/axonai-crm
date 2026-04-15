import type { ReactNode } from 'react';

import AppLayout from '@/components/layout/AppLayout';

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}
