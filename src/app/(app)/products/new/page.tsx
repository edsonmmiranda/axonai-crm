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
import { ProductForm } from '@/components/products/ProductForm';
import { getCategoriesAction } from '@/lib/actions/categories';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

export default async function NewProductPage() {
  const ctx = await getSessionContext();
  if (ctx.role === 'member') {
    redirect('/settings/profile?notice=restricted');
  }

  const categoriesRes = await getCategoriesAction({
    activeOnly: true,
    pageSize: 100,
  });
  const categories =
    categoriesRes.success && categoriesRes.data
      ? categoriesRes.data.map((c) => ({ id: c.id, name: c.name }))
      : [];

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/products"
        className="inline-flex w-fit items-center gap-1 text-sm text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:shadow-focus rounded"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Voltar para produtos
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>Novo produto</CardTitle>
          <CardDescription>
            Cadastre os dados básicos. Após salvar, você pode adicionar imagens e documentos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProductForm mode="create" categories={categories} />
        </CardContent>
      </Card>
    </div>
  );
}
