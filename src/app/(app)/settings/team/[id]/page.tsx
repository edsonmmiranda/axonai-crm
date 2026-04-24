import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { MemberForm } from '@/components/settings/MemberForm';
import { getTeamMemberByIdAction } from '@/lib/actions/team';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

export default async function EditMemberPage(props: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getSessionContext();
  if (ctx.role === 'user' || ctx.role === 'viewer') {
    redirect('/settings/profile?notice=restricted');
  }

  const { id } = await props.params;
  const res = await getTeamMemberByIdAction(id);
  if (!res.success || !res.data) {
    notFound();
  }

  const member = res.data;

  if (member.id === ctx.userId) {
    redirect('/settings/team?notice=self-edit-blocked');
  }
  if (member.role === 'owner') {
    redirect('/settings/team?notice=owner-readonly');
  }
  if (member.role === 'admin' && ctx.role !== 'owner') {
    redirect('/settings/team?notice=admin-owner-only');
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/settings/team"
        className="inline-flex w-fit items-center gap-1 text-sm text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:shadow-focus rounded"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Voltar para equipe
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>Editar membro</CardTitle>
          <CardDescription>
            Ajuste a role e o status de acesso. Owner e a própria conta não podem ser editados aqui.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MemberForm member={member} />
        </CardContent>
      </Card>
    </div>
  );
}
