'use client';

import Link from 'next/link';
import { Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface CategoryRowActionsProps {
  id: string;
  name: string;
}

export function CategoryRowActions({ id, name }: CategoryRowActionsProps) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/settings/catalog/categories/${id}`} aria-label={`Editar ${name}`}>
          <Pencil className="size-4" aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}
