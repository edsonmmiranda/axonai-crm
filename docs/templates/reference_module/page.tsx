import { redirect } from 'next/navigation';
import { getItemsAction } from '@/lib/actions/item';
import { ItemList } from '@/components/items/item-list';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

type SearchParams = {
  page?: string;
  itemsPerPage?: string;
  search?: string;
  sort?: 'name' | 'created_at';
  order?: 'asc' | 'desc';
};

export default async function ItemsPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const searchParams = await props.searchParams;
  const page = Number(searchParams.page) || 1;
  const itemsPerPage = Number(searchParams.itemsPerPage) || 10;

  const result = await getItemsAction({
    page,
    itemsPerPage,
    search: searchParams.search,
    sort: searchParams.sort,
    order: searchParams.order,
  });

  if (!result.success) {
    if (result.error === 'Não autenticado') redirect('/login');
    return (
      <section className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold text-text-primary">Items</h1>
        <p className="text-text-danger">{result.error}</p>
      </section>
    );
  }

  return (
    <section className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text-primary">Items</h1>
        <Button asChild>
          <Link href="/items/new">Novo item</Link>
        </Button>
      </header>

      <ItemList
        items={result.data.items}
        pagination={result.metadata!}
      />
    </section>
  );
}
