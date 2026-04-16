import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

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
              href="/products"
              className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
            >
              Produtos
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-4 text-text-muted" />
          </li>
          <li className="font-semibold text-text-primary">Novo produto</li>
        </ol>
      </nav>

      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight text-text-primary">
          Novo produto
        </h2>
        <p className="max-w-2xl text-text-secondary">
          Cadastre as informações do produto. Após salvar, você poderá adicionar
          imagens e documentos.
        </p>
      </div>

      <ProductForm mode="create" categories={categories} />
    </div>
  );
}
