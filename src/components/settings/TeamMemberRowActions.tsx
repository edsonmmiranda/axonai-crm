import Link from 'next/link';
import { Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { SessionRole } from '@/lib/supabase/getSessionContext';

interface TeamMemberRowActionsProps {
  memberId: string;
  memberName: string;
  memberRole: SessionRole;
  viewerId: string;
  viewerRole: SessionRole;
}

export function TeamMemberRowActions({
  memberId,
  memberName,
  memberRole,
  viewerId,
  viewerRole,
}: TeamMemberRowActionsProps) {
  const isSelf = memberId === viewerId;
  const isOwner = memberRole === 'owner';
  const canEdit =
    !isSelf && !isOwner && (viewerRole === 'owner' || memberRole === 'member');

  if (!canEdit) {
    return <span className="text-xs text-text-muted">—</span>;
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/settings/team/${memberId}`} aria-label={`Editar ${memberName}`}>
          <Pencil className="size-4" aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}
