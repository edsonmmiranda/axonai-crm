'use client';

import Link from 'next/link';
import { Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface LossReasonRowActionsProps {
  id: string;
  name: string;
}

export function LossReasonRowActions({ id, name }: LossReasonRowActionsProps) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/leads/loss-reasons/${id}`} aria-label={`Editar ${name}`}>
          <Pencil className="size-4" aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}
