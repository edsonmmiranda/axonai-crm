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
import { LeadOriginForm } from '@/components/lead-origins/LeadOriginForm';
import { getLeadOriginByIdAction } from '@/lib/actions/lead-origins';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

export default async function EditLeadOriginPage(props: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getSessionContext();
  if (ctx.role === 'member') {
    redirect('/leads?notice=restricted');
  }

  const { id } = await props.params;
  const res = await getLeadOriginByIdAction(id);
  if (!res.success || !res.data) {
    notFound();
  }

  const origin = res.data;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/leads/origins"
        className="inline-flex w-fit items-center gap-1 text-sm text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:shadow-focus rounded"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Voltar para origens
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>Editar origem</CardTitle>
          <CardDescription>
            Atualize os dados desta origem de leads.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeadOriginForm mode="edit" origin={origin} />
        </CardContent>
      </Card>
    </div>
  );
}
