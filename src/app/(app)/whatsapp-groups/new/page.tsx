import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { WhatsappGroupForm } from '@/components/whatsapp-groups/WhatsappGroupForm';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

export default async function NewWhatsappGroupPage() {
  const ctx = await getSessionContext();
  if (ctx.role === 'member') {
    redirect('/dashboard?notice=restricted');
  }

  return (
    <div className="mr-auto flex max-w-page flex-col gap-6 pb-10">
      <nav className="flex text-sm font-medium text-text-secondary" aria-label="breadcrumb">
        <ol className="flex items-center gap-2">
          <li>
            <Link
              href="/dashboard"
              className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
            >
              Home
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-4 text-text-muted" />
          </li>
          <li>
            <Link
              href="/whatsapp-groups"
              className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
            >
              Grupos de WhatsApp
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-4 text-text-muted" />
          </li>
          <li className="font-semibold text-text-primary">Novo grupo</li>
        </ol>
      </nav>

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">Novo grupo</h2>
          <p className="text-sm text-text-secondary">
            Preencha os dados para cadastrar um novo grupo de WhatsApp.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button asChild variant="secondary">
            <Link href="/whatsapp-groups">Cancelar</Link>
          </Button>
          <Button type="submit" form="whatsapp-group-form">
            Criar grupo
          </Button>
        </div>
      </div>

      <WhatsappGroupForm mode="create" />
    </div>
  );
}
