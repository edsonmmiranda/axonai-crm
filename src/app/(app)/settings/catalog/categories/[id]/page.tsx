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
import { CategoryForm } from '@/components/categories/CategoryForm';
import { getCategoryByIdAction } from '@/lib/actions/categories';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

export default async function EditCategoryPage(props: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getSessionContext();
  if (ctx.role === 'member') {
    redirect('/settings/profile?notice=restricted');
  }

  const { id } = await props.params;
  const res = await getCategoryByIdAction(id);
  if (!res.success || !res.data) {
    notFound();
  }

  const category = res.data;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/settings/catalog/categories"
        className="inline-flex w-fit items-center gap-1 text-sm text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:shadow-focus rounded"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Voltar para categorias
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>Editar categoria</CardTitle>
          <CardDescription>
            Atualize os dados desta categoria. O slug é regenerado se o nome mudar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CategoryForm mode="edit" category={category} isAdmin />
        </CardContent>
      </Card>
    </div>
  );
}
