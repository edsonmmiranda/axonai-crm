'use client';

import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { updateAdminThemePreferenceAction } from '@/lib/actions/admin/preferences';

export function AdminThemeToggle() {
  return <ThemeToggle persistAction={updateAdminThemePreferenceAction} />;
}
