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
import { CategoriesList } from '@/components/categories/CategoriesList';
import { CategoriesToolbar } from '@/components/categories/CategoriesToolbar';
import { getCategoriesAction } from '@/lib/actions/categories';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

interface SearchParams {
  search?: string;
  showInactive?: string;
  page?: string;
}

export default async function CategoriesPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getSessionContext();
  if (ctx.role === 'user' || ctx.role === 'viewer') {
    redirect('/settings/profile?notice=restricted');
  }

  const searchParams = await props.searchParams;
  const search = searchParams.search?.trim() || undefined;
  const showInactive = searchParams.showInactive === '1';
  const page = Math.max(1, Number(searchParams.page) || 1);

  const res = await getCategoriesAction({
    search,
    activeOnly: !showInactive,
    page,
    pageSize: 20,
  });

  const hasFilter = Boolean(search) || showInactive;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Categorias</CardTitle>
            <CardDescription>
              Organize o catálogo de produtos por categoria.
            </CardDescription>
          </div>
          <Button asChild>
            <Link href="/settings/catalog/categories/new">Nova categoria</Link>
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-6">
          <CategoriesToolbar />
          {res.success && res.data ? (
            <CategoriesList categories={res.data} hasFilter={hasFilter} />
          ) : (
            <p className="text-sm text-feedback-danger-fg">
              {res.error ?? 'Erro ao carregar categorias.'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
