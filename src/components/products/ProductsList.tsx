import Image from 'next/image';
import Link from 'next/link';
import { Folder, Package } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ProductListRow } from '@/lib/actions/products';

import { ProductRowActions } from './ProductRowActions';
import { ProductsSortableHeader } from './ProductsSortableHeader';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function formatPrice(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function formatStock(value: number | null): string {
  if (value === null) return '—';
  return value.toLocaleString('pt-BR');
}

interface StatusStyle {
  label: string;
  className: string;
}

const STATUS_STYLES: Record<'active' | 'archived', StatusStyle> = {
  active: {
    label: 'Ativo',
    className: 'bg-feedback-success-bg text-feedback-success-fg border-feedback-success-border',
  },
  archived: {
    label: 'Arquivado',
    className: 'bg-surface-sunken text-text-muted border-border-subtle',
  },
};

interface ProductsListProps {
  products: ProductListRow[];
  hasFilter: boolean;
  thumbnailUrls: Record<string, string | null>;
}

export function ProductsList({ products, hasFilter, thumbnailUrls }: ProductsListProps) {
  if (products.length === 0) {
    if (hasFilter) {
      return (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <p className="text-sm font-medium text-text-primary">
            Nenhum produto encontrado
          </p>
          <p className="text-sm text-text-secondary">
            Tente ajustar a busca ou remover filtros.
          </p>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <p className="text-sm font-medium text-text-primary">
          Nenhum produto cadastrado
        </p>
        <p className="text-sm text-text-secondary">
          Cadastre o primeiro produto para montar seu catálogo.
        </p>
        <Button asChild className="mt-2">
          <Link href="/products/new">Cadastrar primeiro produto</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-border-subtle bg-surface-sunken text-xs uppercase text-text-secondary">
          <tr>
            <th
              scope="col"
              className="py-3.5 pl-6 pr-3 font-semibold tracking-wide"
            >
              Imagem
            </th>
            <ProductsSortableHeader sortKey="name" label="Nome" />
            <ProductsSortableHeader sortKey="sku" label="SKU" />
            <th
              scope="col"
              className="px-3 py-3.5 font-semibold tracking-wide"
            >
              Categoria
            </th>
            <ProductsSortableHeader sortKey="price" label="Preço" />
            <ProductsSortableHeader sortKey="stock" label="Estoque" />
            <ProductsSortableHeader sortKey="status" label="Status" />
            <ProductsSortableHeader sortKey="created_at" label="Criado em" />
            <th
              scope="col"
              className="py-3.5 pl-3 pr-6 text-right font-semibold tracking-wide"
            >
              Ações
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {products.map((p) => {
            const thumbUrl = p.primary_image_path
              ? thumbnailUrls[p.primary_image_path] ?? null
              : null;
            const statusStyle = STATUS_STYLES[p.status];
            return (
              <tr
                key={p.id}
                className="group transition-colors hover:bg-surface-sunken/80"
              >
                <td className="whitespace-nowrap py-4 pl-6 pr-3">
                  <div className="flex size-10 items-center justify-center overflow-hidden rounded-md border border-border-subtle bg-surface-sunken">
                    {thumbUrl ? (
                      <Image
                        src={thumbUrl}
                        alt=""
                        width={40}
                        height={40}
                        className="size-10 object-cover"
                        unoptimized
                      />
                    ) : (
                      <Package
                        className="size-5 text-text-muted"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-4">
                  <Link
                    href={`/products/${p.id}`}
                    className="rounded font-bold text-text-primary transition-colors hover:text-action-primary focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    {p.name}
                  </Link>
                  {p.brand ? (
                    <div className="text-xs text-text-secondary">{p.brand}</div>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-3 py-4 font-mono text-xs text-text-secondary">
                  {p.sku}
                </td>
                <td className="whitespace-nowrap px-3 py-4">
                  {p.category_name ? (
                    <span className="inline-flex items-center gap-1 rounded border border-border bg-surface-sunken px-2 py-1 text-xs font-medium text-text-secondary">
                      <Folder className="size-3.5" aria-hidden="true" />
                      {p.category_name}
                    </span>
                  ) : (
                    <span className="text-xs text-text-muted">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-4">
                  <span className="font-semibold text-text-primary">
                    {formatPrice(p.price)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-text-secondary">
                  {formatStock(p.stock)}
                </td>
                <td className="whitespace-nowrap px-3 py-4">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusStyle.className}`}
                  >
                    {statusStyle.label}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-text-secondary">
                  {formatDate(p.created_at)}
                </td>
                <td className="whitespace-nowrap py-4 pl-3 pr-6 text-right">
                  <ProductRowActions id={p.id} name={p.name} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
