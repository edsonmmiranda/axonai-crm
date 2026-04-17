import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { LeadOriginForm } from '@/components/lead-origins/LeadOriginForm';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

export default async function NewLeadOriginPage() {
  const ctx = await getSessionContext();
  if (ctx.role === 'member') {
    redirect('/leads?notice=restricted');
  }

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
          <CardTitle>Nova origem</CardTitle>
          <CardDescription>
            Preencha os dados para criar uma nova origem de leads.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeadOriginForm mode="create" />
        </CardContent>
      </Card>
    </div>
  );
}
