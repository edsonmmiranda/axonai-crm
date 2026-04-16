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
import { ProductDocumentList } from '@/components/products/ProductDocumentList';
import { ProductForm } from '@/components/products/ProductForm';
import { ProductImageGallery } from '@/components/products/ProductImageGallery';
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
    <div className="flex flex-col gap-6">
      <Link
        href="/products"
        className="inline-flex w-fit items-center gap-1 text-sm text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:shadow-focus rounded"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Voltar para produtos
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
          {product.name}
        </h1>
        <p className="text-sm text-text-secondary">
          SKU <span className="font-mono">{product.sku}</span>
          {product.category_name ? ` · ${product.category_name}` : ''}
        </p>
      </div>

      <ProductForm mode="edit" product={product} categories={categories} />

      <Card>
        <CardHeader>
          <CardTitle>Galeria de imagens</CardTitle>
          <CardDescription>
            Controle a capa e a ordem das imagens do produto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProductImageGallery productId={product.id} images={galleryItems} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documentos</CardTitle>
          <CardDescription>
            Manuais, fichas técnicas e certificados para apoio de vendas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProductDocumentList productId={product.id} documents={documentItems} />
        </CardContent>
      </Card>
    </div>
  );
}
