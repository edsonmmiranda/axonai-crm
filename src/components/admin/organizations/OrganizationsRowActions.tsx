'use client';

import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { OrgSuspendDialog } from './OrgSuspendDialog';
import { OrgReactivateDialog } from './OrgReactivateDialog';
import type { OrgListItem } from '@/lib/actions/admin/organizations';
import type { PlatformAdminRole } from '@/lib/auth/platformAdmin';

interface Props {
  org: OrgListItem;
  adminRole: PlatformAdminRole;
}

export function OrganizationsRowActions({ org, adminRole }: Props) {
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);

  const isOwner = adminRole === 'owner';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center justify-center size-8 rounded-md text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary focus-visible:outline-none focus-visible:shadow-focus"
            aria-label={`Ações para ${org.name}`}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isOwner && org.isActive && !org.isInternal && (
            <DropdownMenuItem
              className="text-feedback-danger-fg focus:text-feedback-danger-fg"
              onSelect={() => setSuspendOpen(true)}
            >
              Suspender
            </DropdownMenuItem>
          )}
          {isOwner && !org.isActive && (
            <DropdownMenuItem onSelect={() => setReactivateOpen(true)}>
              Reativar
            </DropdownMenuItem>
          )}
          {/* Se não há ações disponíveis, mostrar placeholder */}
          {(!isOwner || org.isInternal) && (
            <DropdownMenuItem disabled>Sem ações disponíveis</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {suspendOpen && (
        <OrgSuspendDialog
          orgId={org.id}
          orgSlug={org.slug}
          orgName={org.name}
          open={suspendOpen}
          onClose={() => setSuspendOpen(false)}
        />
      )}
      {reactivateOpen && (
        <OrgReactivateDialog
          orgId={org.id}
          orgSlug={org.slug}
          orgName={org.name}
          open={reactivateOpen}
          onClose={() => setReactivateOpen(false)}
        />
      )}
    </>
  );
}
