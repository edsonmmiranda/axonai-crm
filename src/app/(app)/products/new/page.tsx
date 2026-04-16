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
    <div className="flex flex-col gap-6 pb-10">
      <nav
        aria-label="breadcrumb"
        className="flex items-center gap-2 text-sm text-text-secondary"
      >
        <Link
          href="/"
          className="rounded transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:shadow-focus"
        >
          Home
        </Link>
        <ChevronRight className="size-4 text-text-muted" aria-hidden="true" />
        <Link
          href="/products"
          className="rounded transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:shadow-focus"
        >
          Produtos
        </Link>
        <ChevronRight className="size-4 text-text-muted" aria-hidden="true" />
        <span className="font-semibold text-text-primary">Novo produto</span>
      </nav>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
          Novo produto
        </h1>
        <p className="text-sm text-text-secondary">
          Cadastre as informações do produto. Após salvar, você poderá adicionar
          imagens e documentos.
        </p>
      </div>

      <ProductForm mode="create" categories={categories} />
    </div>
  );
}
