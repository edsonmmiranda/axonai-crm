import { ItemForm } from '@/components/items/item-form';

export default function NewItemPage() {
  return (
    <section className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">Novo item</h1>
        <p className="text-text-secondary">Preencha os dados para criar um novo item.</p>
      </header>
      <ItemForm mode="create" />
    </section>
  );
}
