import Image from 'next/image';
import Link from 'next/link';
import { Package } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ProductListRow } from '@/lib/actions/products';
import { ProductRowActions } from './ProductRowActions';

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
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
            <th scope="col" className="px-4 py-3 font-semibold">
              Imagem
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Nome
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              SKU
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Categoria
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Preço
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Estoque
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Status
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Criado em
            </th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">
              Ações
            </th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const thumbUrl = p.primary_image_path
              ? thumbnailUrls[p.primary_image_path] ?? null
              : null;
            return (
              <tr key={p.id} className="border-b border-subtle">
                <td className="px-4 py-3">
                  <div className="flex size-10 items-center justify-center overflow-hidden rounded-md border border-subtle bg-surface-sunken">
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
                <td className="px-4 py-3">
                  <Link
                    href={`/products/${p.id}`}
                    className="font-medium text-text-primary hover:text-action-primary focus-visible:outline-none focus-visible:shadow-focus rounded"
                  >
                    {p.name}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                  {p.sku}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {p.category_name ?? '—'}
                </td>
                <td className="px-4 py-3 text-text-primary">
                  {formatPrice(p.price)}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {formatStock(p.stock)}
                </td>
                <td className="px-4 py-3">
                  <Badge
                    variant={p.status === 'active' ? 'role-admin' : 'status-inactive'}
                  >
                    {p.status === 'active' ? 'Ativo' : 'Arquivado'}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {formatDate(p.created_at)}
                </td>
                <td className="px-4 py-3">
                  <ProductRowActions id={p.id} name={p.name} status={p.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
