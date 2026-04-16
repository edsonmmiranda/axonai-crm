'use client';

import { useTransition } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { updateThemePreferenceAction } from '@/lib/actions/profile';
import type { ThemePreference } from '@/lib/supabase/getSessionContext';

import { useTheme } from './ThemeProvider';

interface ThemeOption {
  value: ThemePreference;
  label: string;
  icon: LucideIcon;
}

const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
] as const;

function getTriggerIcon(theme: ThemePreference, resolved: 'light' | 'dark'): LucideIcon {
  if (theme === 'system') return Monitor;
  return resolved === 'dark' ? Moon : Sun;
}

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [, startTransition] = useTransition();

  const handleSelect = (next: ThemePreference) => {
    setTheme(next);
    startTransition(async () => {
      const result = await updateThemePreferenceAction({ theme: next });
      if (!result.success) {
        toast.error(result.error ?? 'Não foi possível salvar tema');
      }
    });
  };

  const TriggerIcon = getTriggerIcon(theme, resolvedTheme);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Alterar tema"
          className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-surface-sunken hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus data-[state=open]:bg-surface-sunken data-[state=open]:text-action-ghost-fg"
        >
          <TriggerIcon className="size-5" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-30 w-44 rounded-lg border border-border bg-surface-raised p-1 shadow-md"
        >
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            const selected = option.value === theme;
            return (
              <DropdownMenu.Item
                key={option.value}
                onSelect={() => handleSelect(option.value)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm outline-none transition-colors',
                  'focus-visible:shadow-focus data-[highlighted]:bg-surface-sunken data-[highlighted]:text-text-primary',
                  selected ? 'text-text-primary' : 'text-text-secondary'
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span className="flex-1">{option.label}</span>
                {selected && <Check className="size-4" aria-hidden="true" />}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
