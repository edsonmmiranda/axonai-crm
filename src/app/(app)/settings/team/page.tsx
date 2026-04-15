import { redirect } from 'next/navigation';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TeamMembersList } from '@/components/settings/TeamMembersList';
import { PendingInvitationsList } from '@/components/settings/PendingInvitationsList';
import { InviteMemberDialog } from '@/components/settings/InviteMemberDialog';
import {
  getPendingInvitationsAction,
  getTeamMembersAction,
} from '@/lib/actions/invitations';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

export default async function TeamPage() {
  const ctx = await getSessionContext();
  if (ctx.role === 'member') {
    redirect('/settings/profile?notice=restricted');
  }

  const [membersRes, invitesRes] = await Promise.all([
    getTeamMembersAction(),
    getPendingInvitationsAction(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Membros</CardTitle>
            <CardDescription>
              Pessoas com acesso à sua organização.
            </CardDescription>
          </div>
          <InviteMemberDialog />
        </CardHeader>
        <CardContent className="p-0">
          {membersRes.success && membersRes.data ? (
            <TeamMembersList members={membersRes.data} />
          ) : (
            <p className="px-6 py-6 text-sm text-feedback-danger-fg">
              {membersRes.error ?? 'Erro ao carregar membros.'}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Convites pendentes</CardTitle>
          <CardDescription>
            Convites aguardando aceite. Expiram em 7 dias.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {invitesRes.success && invitesRes.data ? (
            <PendingInvitationsList invitations={invitesRes.data} />
          ) : (
            <p className="px-6 py-6 text-sm text-feedback-danger-fg">
              {invitesRes.error ?? 'Erro ao carregar convites.'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
