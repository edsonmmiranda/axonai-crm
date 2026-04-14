import { notFound, redirect } from 'next/navigation';
import { getItemByIdAction } from '@/lib/actions/item';
import { ItemForm } from '@/components/items/item-form';

export default async function EditItemPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const result = await getItemByIdAction(id);

  if (!result.success) {
    if (result.error === 'Não autenticado') redirect('/login');
    notFound();
  }

  return (
    <section className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">Editar item</h1>
        <p className="text-text-secondary">Atualize os dados ou remova o item.</p>
      </header>
      <ItemForm mode="edit" item={result.data} />
    </section>
  );
}
