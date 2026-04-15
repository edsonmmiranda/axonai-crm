import { redirect } from 'next/navigation';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { OrganizationForm } from '@/components/settings/OrganizationForm';
import { getSessionContext } from '@/lib/supabase/getSessionContext';
import { getOrganizationAction } from '@/lib/actions/organization';

export default async function OrganizationPage() {
  const ctx = await getSessionContext();
  if (ctx.role === 'member') {
    redirect('/settings/profile?notice=restricted');
  }

  const res = await getOrganizationAction();
  if (!res.success || !res.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Organização</CardTitle>
          <CardDescription>Não foi possível carregar os dados.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-feedback-danger-fg">
            {res.error ?? 'Erro desconhecido.'}
          </p>
        </CardContent>
      </Card>
    );
  }

  const org = res.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organização</CardTitle>
        <CardDescription>Edite o nome e o slug da sua organização.</CardDescription>
      </CardHeader>
      <CardContent>
        <OrganizationForm
          organization={{
            name: org.name,
            slug: org.slug,
            plan: org.plan,
            maxUsers: org.max_users,
          }}
        />
      </CardContent>
    </Card>
  );
}
