import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ProfileForm } from '@/components/settings/ProfileForm';
import { getSessionContext } from '@/lib/supabase/getSessionContext';
import { createClient } from '@/lib/supabase/server';

export default async function ProfilePage() {
  const ctx = await getSessionContext();
  const supabase = await createClient();

  const { data: row } = await supabase
    .from('profiles')
    .select('full_name, phone, avatar_url, email, preferences')
    .eq('id', ctx.userId)
    .single<{
      full_name: string | null;
      phone: string | null;
      avatar_url: string | null;
      email: string | null;
      preferences: { emailNotifications?: boolean } | null;
    }>();

  const profile = {
    fullName: row?.full_name ?? ctx.fullName ?? '',
    phone: row?.phone ?? null,
    avatarUrl: row?.avatar_url ?? ctx.avatarUrl,
    email: row?.email ?? null,
    preferences: row?.preferences ?? null,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meu perfil</CardTitle>
        <CardDescription>Atualize seu nome, foto e preferências pessoais.</CardDescription>
      </CardHeader>
      <CardContent>
        <ProfileForm profile={profile} />
      </CardContent>
    </Card>
  );
}
