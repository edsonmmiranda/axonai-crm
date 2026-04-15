import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { CategoryRow } from '@/lib/actions/categories';
import { CategoryRowActions } from './CategoryRowActions';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function truncate(input: string | null, max = 80): string {
  if (!input) return '—';
  if (input.length <= max) return input;
  return `${input.slice(0, max)}…`;
}

interface CategoriesListProps {
  categories: CategoryRow[];
  hasFilter: boolean;
}

export function CategoriesList({ categories, hasFilter }: CategoriesListProps) {
  if (categories.length === 0) {
    if (hasFilter) {
      return (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <p className="text-sm font-medium text-text-primary">
            Nenhuma categoria encontrada
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
          Nenhuma categoria ainda
        </p>
        <p className="text-sm text-text-secondary">
          Crie sua primeira categoria para começar a organizar o catálogo.
        </p>
        <Button asChild className="mt-2">
          <Link href="/settings/catalog/categories/new">Criar primeira categoria</Link>
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
              Nome
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Slug
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Descrição
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
          {categories.map((c) => (
            <tr key={c.id} className="border-b border-subtle">
              <td className="px-4 py-3">
                <Link
                  href={`/settings/catalog/categories/${c.id}`}
                  className="font-medium text-text-primary hover:text-action-primary focus-visible:outline-none focus-visible:shadow-focus rounded"
                >
                  {c.name}
                </Link>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                {c.slug}
              </td>
              <td className="px-4 py-3 text-text-secondary">
                {truncate(c.description)}
              </td>
              <td className="px-4 py-3">
                <Badge variant={c.active ? 'role-admin' : 'status-inactive'}>
                  {c.active ? 'Ativa' : 'Inativa'}
                </Badge>
              </td>
              <td className="px-4 py-3 text-text-secondary">
                {formatDate(c.created_at)}
              </td>
              <td className="px-4 py-3">
                <CategoryRowActions id={c.id} name={c.name} active={c.active} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
