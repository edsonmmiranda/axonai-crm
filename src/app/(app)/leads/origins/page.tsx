import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { LeadOriginsList } from '@/components/lead-origins/LeadOriginsList';
import { LeadOriginsToolbar } from '@/components/lead-origins/LeadOriginsToolbar';
import { getLeadOriginsAction } from '@/lib/actions/lead-origins';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

interface SearchParams {
  search?: string;
  type?: string;
  showInactive?: string;
  page?: string;
}

export default async function LeadOriginsPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getSessionContext();
  if (ctx.role === 'member') {
    redirect('/leads?notice=restricted');
  }

  const searchParams = await props.searchParams;
  const search = searchParams.search?.trim() || undefined;
  const type = searchParams.type?.trim() || undefined;
  const showInactive = searchParams.showInactive === '1';
  const page = Math.max(1, Number(searchParams.page) || 1);

  const res = await getLeadOriginsAction({
    search,
    type,
    isActive: showInactive ? undefined : true,
    page,
    pageSize: 20,
  });

  const hasFilter = Boolean(search) || Boolean(type) || showInactive;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Origens de Leads</CardTitle>
            <CardDescription>
              Gerencie as origens de captação dos seus leads.
            </CardDescription>
          </div>
          <Button asChild>
            <Link href="/leads/origins/new">Nova origem</Link>
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-6">
          <LeadOriginsToolbar />
          {res.success && res.data ? (
            <LeadOriginsList
              origins={res.data}
              hasFilter={hasFilter}
              metadata={res.metadata}
            />
          ) : (
            <p className="text-sm text-feedback-danger-fg">
              {res.error ?? 'Erro ao carregar origens.'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
