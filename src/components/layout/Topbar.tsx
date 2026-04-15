'use client';

import { Bell, Search, Settings } from 'lucide-react';

export function Topbar() {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-surface-raised/80 px-6 backdrop-blur-md">
      <div className="hidden max-w-md flex-1 sm:flex">
        <div className="group relative w-full">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Search
              className="size-5 text-text-secondary transition-colors group-focus-within:text-action-primary"
              aria-hidden="true"
            />
          </div>
          <input
            type="text"
            placeholder="Buscar leads, empresas ou contratos..."
            aria-label="Busca global"
            className="block w-full rounded-lg border border-field-border bg-field py-2 pl-10 pr-3 text-sm leading-5 text-field-fg shadow-sm transition-all placeholder:text-field-placeholder hover:border-field-border-hover focus-visible:border-field-border-focus focus-visible:bg-surface-raised focus-visible:outline-none focus-visible:shadow-focus"
          />
        </div>
      </div>

      <div className="ml-4 flex items-center gap-4">
        <button
          type="button"
          aria-label="Notificações"
          className="relative rounded-lg p-2 text-text-secondary transition-colors hover:bg-surface-sunken hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
        >
          <Bell className="size-5" aria-hidden="true" />
          <span className="absolute right-2 top-2 size-2 rounded-full border-2 border-surface-raised bg-feedback-danger-solid-bg" />
        </button>
        <button
          type="button"
          aria-label="Configurações"
          className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-surface-sunken hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
        >
          <Settings className="size-5" aria-hidden="true" />
        </button>
        <div className="mx-2 h-8 w-px bg-border" aria-hidden="true" />
        <div className="group flex cursor-pointer items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium text-text-primary transition-colors group-hover:text-action-ghost-fg">
              Roberto Silva
            </p>
            <p className="text-xs text-text-secondary">Executivo de Contas</p>
          </div>
          <div className="flex size-9 items-center justify-center rounded-full border-2 border-transparent bg-action-primary text-sm font-bold text-action-primary-fg shadow-sm transition-all group-hover:border-action-primary">
            RS
          </div>
        </div>
      </div>
    </header>
  );
}
