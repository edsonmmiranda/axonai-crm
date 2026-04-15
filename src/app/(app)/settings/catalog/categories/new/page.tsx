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
import { CategoryForm } from '@/components/categories/CategoryForm';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

export default async function NewCategoryPage() {
  const ctx = await getSessionContext();
  if (ctx.role === 'member') {
    redirect('/settings/profile?notice=restricted');
  }

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
          <CardTitle>Nova categoria</CardTitle>
          <CardDescription>
            Preencha o nome e a descrição para criar uma categoria.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CategoryForm mode="create" />
        </CardContent>
      </Card>
    </div>
  );
}
