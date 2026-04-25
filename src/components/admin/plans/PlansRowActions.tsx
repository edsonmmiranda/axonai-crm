'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ArchivePlanDialog } from './ArchivePlanDialog';
import { DeletePlanDialog } from './DeletePlanDialog';
import { archivePlanAction } from '@/lib/actions/admin/plans';
import type { PlanListItem } from '@/lib/actions/admin/plans';
import type { PlatformAdminRole } from '@/lib/auth/platformAdmin';

interface Props {
  plan: PlanListItem;
  adminRole: PlatformAdminRole;
}

export function PlansRowActions({ plan, adminRole }: Props) {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const isOwner = adminRole === 'owner';
  const canDelete = plan.activeSubscriptionsCount === 0;

  function handleArchive() {
    startTransition(async () => {
      const res = await archivePlanAction({ id: plan.id });
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível arquivar o plano.');
        return;
      }
      toast.success(`Plano "${plan.name}" arquivado.`);
      setArchiveOpen(false);
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center justify-center size-8 rounded-md text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary focus-visible:outline-none focus-visible:shadow-focus"
            aria-label={`Ações para ${plan.name}`}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isOwner && !plan.isArchived && (
            <DropdownMenuItem asChild>
              <Link href={`/admin/plans/${plan.id}/edit`}>Editar</Link>
            </DropdownMenuItem>
          )}
          {isOwner && !plan.isArchived && (
            <DropdownMenuItem onSelect={() => setArchiveOpen(true)}>
              Arquivar
            </DropdownMenuItem>
          )}
          {isOwner && canDelete && (
            <DropdownMenuItem
              className="text-feedback-danger-fg focus:text-feedback-danger-fg"
              onSelect={() => setDeleteOpen(true)}
            >
              Excluir
            </DropdownMenuItem>
          )}
          {(!isOwner || (plan.isArchived && !canDelete)) && (
            <DropdownMenuItem disabled>Sem ações disponíveis</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {archiveOpen && (
        <ArchivePlanDialog
          open={archiveOpen}
          onClose={() => setArchiveOpen(false)}
          onConfirm={handleArchive}
          isPending={isPending}
        />
      )}
      {deleteOpen && (
        <DeletePlanDialog
          plan={plan}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </>
  );
}
