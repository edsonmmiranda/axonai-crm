import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import { ProductForm } from '@/components/products/ProductForm';
import { getCategoriesAction } from '@/lib/actions/categories';
import { getProductByIdAction } from '@/lib/actions/products';
import { getSignedUrlsBatch } from '@/lib/storage/signed-urls';
import { getSessionContext } from '@/lib/supabase/getSessionContext';

export default async function EditProductPage(props: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getSessionContext();
  if (ctx.role === 'member') {
    redirect('/settings/profile?notice=restricted');
  }

  const { id } = await props.params;
  const [productRes, categoriesRes] = await Promise.all([
    getProductByIdAction(id),
    getCategoriesAction({ activeOnly: true, pageSize: 100 }),
  ]);

  if (!productRes.success || !productRes.data) {
    notFound();
  }

  const product = productRes.data;
  const categories =
    categoriesRes.success && categoriesRes.data
      ? categoriesRes.data.map((c) => ({ id: c.id, name: c.name }))
      : [];

  const imagePaths = product.images.map((img) => img.url);
  const imageUrlMap =
    imagePaths.length > 0
      ? await getSignedUrlsBatch('products', imagePaths, 3600)
      : {};

  const galleryItems = product.images.map((img) => ({
    id: img.id,
    url: img.url,
    file_name: img.file_name,
    position: img.position,
    is_primary: img.is_primary,
    signed_url: imageUrlMap[img.url] ?? null,
  }));

  const documentItems = product.documents.map((doc) => ({
    id: doc.id,
    file_name: doc.file_name,
    file_size: doc.file_size,
    mime_type: doc.mime_type,
    document_type: doc.document_type,
    created_at: doc.created_at,
  }));

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
          <li className="truncate font-semibold text-text-primary" title={product.name}>
            {product.name}
          </li>
        </ol>
      </nav>

      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight text-text-primary">
          {product.name}
        </h2>
        <p className="max-w-2xl text-text-secondary">
          SKU <span className="font-mono">{product.sku}</span>
          {product.category_name ? ` · ${product.category_name}` : ''}
        </p>
      </div>

      <ProductForm
        mode="edit"
        product={product}
        categories={categories}
        productId={product.id}
        images={galleryItems}
        documents={documentItems}
        isAdmin
      />
    </div>
  );
}
