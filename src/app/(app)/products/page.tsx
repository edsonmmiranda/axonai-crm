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
import { ProductsList } from '@/components/products/ProductsList';
import { ProductsToolbar } from '@/components/products/ProductsToolbar';
import { getCategoriesAction } from '@/lib/actions/categories';
import { getProductsAction } from '@/lib/actions/products';
import { getSignedUrlsBatch } from '@/lib/storage/signed-urls';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

interface SearchParams {
  search?: string;
  categoryId?: string;
  status?: string;
  page?: string;
}

function parseStatus(raw: string | undefined): 'active' | 'archived' | 'all' {
  if (raw === 'archived' || raw === 'all') return raw;
  return 'active';
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
  const pageSize = 20;

  const [productsRes, categoriesRes] = await Promise.all([
    getProductsAction({ search, categoryId, status, page, pageSize }),
    getCategoriesAction({ activeOnly: true, pageSize: 100 }),
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

  function buildPageHref(target: number): string {
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    if (categoryId) qs.set('categoryId', categoryId);
    if (status !== 'active') qs.set('status', status);
    if (target > 1) qs.set('page', String(target));
    const s = qs.toString();
    return s ? `/products?${s}` : '/products';
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Produtos</CardTitle>
          <CardDescription>
            Catálogo da sua organização com imagens e documentos de apoio.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-6">
          <ProductsToolbar categories={categories} />
          {productsRes.success ? (
            <>
              <ProductsList
                products={products}
                hasFilter={hasFilter}
                thumbnailUrls={thumbnailUrls}
              />
              {totalPages > 1 ? (
                <div className="flex items-center justify-between border-t border-subtle pt-4 text-sm text-text-secondary">
                  <p>
                    Página {currentPage} de {totalPages} · {total} produto(s)
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      asChild
                      variant="ghost"
                      size="sm"
                      disabled={currentPage <= 1}
                    >
                      <Link
                        href={buildPageHref(Math.max(1, currentPage - 1))}
                        aria-disabled={currentPage <= 1}
                      >
                        Anterior
                      </Link>
                    </Button>
                    <Button
                      asChild
                      variant="ghost"
                      size="sm"
                      disabled={currentPage >= totalPages}
                    >
                      <Link
                        href={buildPageHref(
                          Math.min(totalPages, currentPage + 1)
                        )}
                        aria-disabled={currentPage >= totalPages}
                      >
                        Próxima
                      </Link>
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-feedback-danger-fg">
              {productsRes.error ?? 'Erro ao carregar produtos.'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
