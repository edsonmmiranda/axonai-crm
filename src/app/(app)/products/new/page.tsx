import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import { ProductForm } from '@/components/products/ProductForm';
import { getCategoriesAction } from '@/lib/actions/categories';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

export default async function NewProductPage() {
  const ctx = await getSessionContext();
  if (ctx.role === 'user' || ctx.role === 'viewer') {
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

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">
            Novo produto
          </h2>
          <p className="text-sm text-text-secondary">
            Cadastre as informações do produto. Após salvar, você poderá adicionar
            imagens e documentos.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/products"
            className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-action-secondary-border bg-action-secondary px-5 text-sm font-semibold text-action-secondary-fg shadow-sm transition-colors hover:bg-action-secondary-hover focus-visible:outline-none focus-visible:shadow-focus"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            form="product-form"
            className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-action-primary px-5 text-sm font-bold text-action-primary-fg shadow-sm transition-colors hover:bg-action-primary-hover focus-visible:outline-none focus-visible:shadow-focus"
          >
            Criar produto
          </button>
        </div>
      </div>

      <ProductForm mode="create" categories={categories} />
    </div>
  );
}
