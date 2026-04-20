'use client';

import Link from 'next/link';
import { useState } from 'react';
import { MoreHorizontal, Pencil, UserPlus, XCircle, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { LeadRow, LossReasonOption, ProfileOption } from '@/lib/actions/leads';
import { MarkAsLostDialog } from './MarkAsLostDialog';
import { AssignLeadDialog } from './AssignLeadDialog';
import { DeleteLeadDialog } from './DeleteLeadDialog';

interface LeadRowActionsProps {
  lead: LeadRow;
  lossReasons: LossReasonOption[];
  profiles: ProfileOption[];
  isAdmin: boolean;
}

export function LeadRowActions({ lead, lossReasons, profiles, isAdmin }: LeadRowActionsProps) {
  const [showLostDialog, setShowLostDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/leads/${lead.id}`} aria-label={`Editar ${lead.name}`}>
          <Pencil className="size-4" aria-hidden="true" />
        </Link>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Mais ações">
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setShowAssignDialog(true)}>
            <UserPlus className="size-4" aria-hidden="true" />
            Atribuir responsável
          </DropdownMenuItem>
          {lead.status !== 'lost' ? (
            <DropdownMenuItem onSelect={() => setShowLostDialog(true)}>
              <XCircle className="size-4" aria-hidden="true" />
              Marcar como perdido
            </DropdownMenuItem>
          ) : null}
          {isAdmin ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setShowDeleteDialog(true)}
                className="text-feedback-danger-fg focus:text-feedback-danger-fg"
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Excluir
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {showLostDialog ? (
        <MarkAsLostDialog
          leadId={lead.id}
          leadName={lead.name}
          lossReasons={lossReasons}
          onClose={() => setShowLostDialog(false)}
        />
      ) : null}

      {showAssignDialog ? (
        <AssignLeadDialog
          leadId={lead.id}
          leadName={lead.name}
          profiles={profiles}
          currentAssignedTo={lead.assigned_to}
          onClose={() => setShowAssignDialog(false)}
        />
      ) : null}

      {showDeleteDialog ? (
        <DeleteLeadDialog
          leadId={lead.id}
          leadName={lead.name}
          onClose={() => setShowDeleteDialog(false)}
        />
      ) : null}
    </div>
  );
}
