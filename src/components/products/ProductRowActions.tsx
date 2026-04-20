'use client';

import Link from 'next/link';
import { Pencil } from 'lucide-react';

interface ProductRowActionsProps {
  id: string;
  name: string;
}

const ICON_BTN_BASE =
  'inline-flex size-8 items-center justify-center rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-50';

export function ProductRowActions({ id, name }: ProductRowActionsProps) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Link
        href={`/products/${id}`}
        aria-label={`Editar ${name}`}
        title="Editar"
        className={`${ICON_BTN_BASE} text-text-muted hover:bg-surface-sunken hover:text-text-primary`}
      >
        <Pencil className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
