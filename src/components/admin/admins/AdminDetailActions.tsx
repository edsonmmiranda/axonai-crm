'use client';

import { useState } from 'react';
import { KeyRound, ShieldOff, UserCog } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { PlatformAdminListRow } from '@/lib/actions/admin/platform-admins.schemas';

import { ChangeRoleDialog } from './ChangeRoleDialog';
import { DeactivateAdminDialog } from './DeactivateAdminDialog';
import { RequestMfaResetDialog } from './RequestMfaResetDialog';

interface Props {
  admin:            PlatformAdminListRow;
  currentProfileId: string;
}

export function AdminDetailActions({ admin, currentProfileId }: Props) {
  const [openChangeRole, setOpenChangeRole]   = useState(false);
  const [openDeactivate, setOpenDeactivate]   = useState(false);
  const [openRequestMfa, setOpenRequestMfa]   = useState(false);

  const adminLabel = admin.fullName ?? admin.email ?? 'Sem nome';
  const isSelf     = admin.profileId === currentProfileId;
  const showMfaReset = !isSelf && admin.isActive;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => setOpenChangeRole(true)}
          disabled={!admin.isActive}
        >
          <UserCog className="size-4" aria-hidden="true" />
          Mudar papel
        </Button>

        {showMfaReset && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setOpenRequestMfa(true)}
          >
            <KeyRound className="size-4" aria-hidden="true" />
            Solicitar reset de MFA
          </Button>
        )}

        <Button
          type="button"
          variant="danger"
          onClick={() => setOpenDeactivate(true)}
          disabled={!admin.isActive}
        >
          <ShieldOff className="size-4" aria-hidden="true" />
          Desativar admin
        </Button>
      </div>

      <ChangeRoleDialog
        adminId={admin.id}
        currentRole={admin.role}
        adminLabel={adminLabel}
        open={openChangeRole}
        onClose={() => setOpenChangeRole(false)}
      />

      <DeactivateAdminDialog
        adminId={admin.id}
        email={admin.email ?? ''}
        adminLabel={adminLabel}
        open={openDeactivate}
        onClose={() => setOpenDeactivate(false)}
      />

      {showMfaReset && (
        <RequestMfaResetDialog
          targetAdminId={admin.id}
          adminLabel={adminLabel}
          open={openRequestMfa}
          onClose={() => setOpenRequestMfa(false)}
        />
      )}
    </>
  );
}
