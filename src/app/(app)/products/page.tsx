import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight, Plus, Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ProductsFiltersBar } from '@/components/products/ProductsFiltersBar';
import { ProductsList } from '@/components/products/ProductsList';
import { ProductsPagination } from '@/components/products/ProductsPagination';
import { ProductsSortPanel } from '@/components/products/ProductsSortPanel';
import { ProductsStatsCards } from '@/components/products/ProductsStatsCards';
import { parseSortParam } from '@/components/products/sort-utils';
import { getCategoriesAction } from '@/lib/actions/categories';
import { getProductsAction, getProductsStatsAction } from '@/lib/actions/products';
import { PRODUCT_PAGE_SIZES, type ProductPageSize } from '@/lib/products/constants';
import { getSignedUrlsBatch } from '@/lib/storage/signed-urls';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

interface SearchParams {
  search?: string;
  categoryId?: string;
  status?: string;
  page?: string;
  pageSize?: string;
  sort?: string;
}

function parseStatus(raw: string | undefined): 'active' | 'archived' | 'all' {
  if (raw === 'archived' || raw === 'all') return raw;
  return 'active';
}

function parsePageSize(raw: string | undefined): ProductPageSize {
  const n = Number(raw);
  if ((PRODUCT_PAGE_SIZES as readonly number[]).includes(n)) {
    return n as ProductPageSize;
  }
  return 20;
}

export default async function ProductsPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getSessionContext();
  if (ctx.role === 'member') {
    redirect('/settings/profile?notice=restricted');
  }

  const searchParams = await props.searchParams;
  const search = searchParams.search?.trim() || undefined;
  const categoryId = searchParams.categoryId || undefined;
  const status = parseStatus(searchParams.status);
  const page = Math.max(1, Number(searchParams.page) || 1);
  const pageSize = parsePageSize(searchParams.pageSize);
  const sort = parseSortParam(searchParams.sort);

  const [productsRes, categoriesRes, statsRes] = await Promise.all([
    getProductsAction({ search, categoryId, status, page, pageSize, sort }),
    getCategoriesAction({ activeOnly: true, pageSize: 100 }),
    getProductsStatsAction(),
  ]);

  const hasFilter =
    Boolean(search) || Boolean(categoryId) || status !== 'active';

  const products = productsRes.success && productsRes.data ? productsRes.data : [];
  const categories =
    categoriesRes.success && categoriesRes.data
      ? categoriesRes.data.map((c) => ({ id: c.id, name: c.name }))
      : [];

  const primaryPaths = Array.from(
    new Set(
      products
        .map((p) => p.primary_image_path)
        .filter((path): path is string => !!path)
    )
  );
  const thumbnailUrls =
    primaryPaths.length > 0
      ? await getSignedUrlsBatch('products', primaryPaths, 3600)
      : {};

  const meta = productsRes.metadata;
  const totalPages = meta?.totalPages ?? 1;
  const currentPage = meta?.currentPage ?? page;
  const total = meta?.total ?? products.length;

  const stats =
    statsRes.success && statsRes.data
      ? statsRes.data
      : { total: 0, active: 0, archived: 0, noStock: 0 };

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
          <li className="font-semibold text-text-primary">Produtos</li>
        </ol>
      </nav>

      <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary">
            Catálogo de Produtos
          </h2>
          <p className="max-w-2xl text-text-secondary">
            Gerencie seu catálogo, mantenha imagens e documentos atualizados e
            acompanhe o estoque dos seus produtos.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" type="button" disabled>
            <Printer className="size-4" aria-hidden="true" />
            Imprimir
          </Button>
          <Button asChild>
            <Link href="/products/new">
              <Plus className="size-4" aria-hidden="true" />
              Novo produto
            </Link>
          </Button>
        </div>
      </div>

      <ProductsStatsCards stats={stats} />

      <ProductsFiltersBar categories={categories} />

      <ProductsSortPanel />

      <div className="overflow-hidden rounded-xl border border-border bg-surface-raised shadow-sm">
        {productsRes.success ? (
          <>
            <ProductsList
              products={products}
              hasFilter={hasFilter}
              thumbnailUrls={thumbnailUrls}
            />
            {sort.length === 0 && total === 0 ? null : (
              <ProductsPagination
                currentPage={currentPage}
                totalPages={totalPages}
                total={total}
                pageSize={pageSize}
              />
            )}
          </>
        ) : (
          <p className="px-6 py-6 text-sm text-feedback-danger-fg">
            {productsRes.error ?? 'Erro ao carregar produtos.'}
          </p>
        )}
      </div>
    </div>
  );
}
