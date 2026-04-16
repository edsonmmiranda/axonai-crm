'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  createProductAction,
  updateProductAction,
  type ProductRow,
} from '@/lib/actions/products';

const CATEGORY_NONE = '__none__';

const FormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Nome deve ter ao menos 2 caracteres')
    .max(255, 'Nome deve ter no máximo 255 caracteres'),
  sku: z
    .string()
    .trim()
    .min(1, 'SKU é obrigatório')
    .max(100, 'SKU deve ter no máximo 100 caracteres')
    .regex(
      /^[A-Za-z0-9_-]+$/,
      'SKU aceita apenas letras, números, hífen e underscore'
    ),
  category_id: z.string(),
  short_description: z
    .string()
    .trim()
    .max(500, 'Resumo deve ter no máximo 500 caracteres')
    .optional(),
  description: z
    .string()
    .trim()
    .max(5000, 'Descrição deve ter no máximo 5000 caracteres')
    .optional(),
  brand: z
    .string()
    .trim()
    .max(100, 'Marca deve ter no máximo 100 caracteres')
    .optional(),
  tags: z
    .string()
    .trim()
    .max(600, 'Lista de tags muito longa')
    .optional(),
  price: z.string().optional(),
  stock: z.string().optional(),
  active: z.boolean(),
  weight: z.string().optional(),
  height: z.string().optional(),
  width: z.string().optional(),
  depth: z.string().optional(),
  notes: z
    .string()
    .trim()
    .max(2000, 'Notas devem ter no máximo 2000 caracteres')
    .optional(),
});

type FormValues = z.infer<typeof FormSchema>;

type TabKey = 'basic' | 'commercial' | 'dimensions' | 'notes';

interface CategoryOption {
  id: string;
  name: string;
}

export interface ProductFormProps {
  mode: 'create' | 'edit';
  product?: ProductRow;
  categories: CategoryOption[];
}

function toNumericOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const normalized = trimmed.replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

function numberToString(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function tagsArrayToString(tags: string[] | null | undefined): string {
  if (!tags || tags.length === 0) return '';
  return tags.join(', ');
}

function tagsStringToArray(input: string | undefined): string[] | undefined {
  if (!input) return undefined;
  const parts = input
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return parts.length > 0 ? parts : undefined;
}

export function ProductForm({ mode, product, categories }: ProductFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('basic');
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: product?.name ?? '',
      sku: product?.sku ?? '',
      category_id: product?.category_id ?? CATEGORY_NONE,
      short_description: product?.short_description ?? '',
      description: product?.description ?? '',
      brand: product?.brand ?? '',
      tags: tagsArrayToString(product?.tags),
      price: numberToString(product?.price),
      stock: numberToString(product?.stock ?? 0),
      active: (product?.status ?? 'active') === 'active',
      weight: numberToString(product?.weight),
      height: numberToString(product?.height),
      width: numberToString(product?.width),
      depth: numberToString(product?.depth),
      notes: product?.notes ?? '',
    },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);

    const price = toNumericOrUndefined(values.price);
    const stockRaw = toNumericOrUndefined(values.stock);
    const weight = toNumericOrUndefined(values.weight);
    const height = toNumericOrUndefined(values.height);
    const width = toNumericOrUndefined(values.width);
    const depth = toNumericOrUndefined(values.depth);

    if (values.price && price === undefined) {
      setError('price', { message: 'Preço inválido' });
      setTab('commercial');
      return;
    }
    if (values.stock && stockRaw === undefined) {
      setError('stock', { message: 'Estoque inválido' });
      setTab('commercial');
      return;
    }
    if (stockRaw !== undefined && !Number.isInteger(stockRaw)) {
      setError('stock', { message: 'Estoque deve ser um número inteiro' });
      setTab('commercial');
      return;
    }

    const payload = {
      name: values.name,
      sku: values.sku,
      category_id:
        values.category_id && values.category_id !== CATEGORY_NONE
          ? values.category_id
          : null,
      short_description: values.short_description || undefined,
      description: values.description || undefined,
      brand: values.brand || undefined,
      tags: tagsStringToArray(values.tags),
      price,
      stock: stockRaw,
      status: (values.active ? 'active' : 'archived') as 'active' | 'archived',
      weight,
      height,
      width,
      depth,
      notes: values.notes || undefined,
    };

    startTransition(async () => {
      const res =
        mode === 'create'
          ? await createProductAction(payload)
          : await updateProductAction(product!.id, payload);

      if (!res.success) {
        const message = res.error ?? 'Não foi possível salvar o produto.';
        const lower = message.toLowerCase();
        if (lower.includes('sku')) {
          setError('sku', { message });
          setTab('basic');
        } else if (lower.includes('nome')) {
          setError('name', { message });
          setTab('basic');
        } else {
          setFormError(message);
        }
        toast.error(message);
        return;
      }

      toast.success(mode === 'create' ? 'Produto criado.' : 'Produto atualizado.');
      if (mode === 'create' && res.data) {
        router.push(`/products/${res.data.id}`);
      } else {
        router.push('/products');
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      {formError ? (
        <div
          role="alert"
          className="rounded-md border border-feedback-danger-border bg-feedback-danger-bg px-4 py-3 text-sm text-feedback-danger-fg"
        >
          {formError}
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="basic">Básico</TabsTrigger>
          <TabsTrigger value="commercial">Comercial</TabsTrigger>
          <TabsTrigger value="dimensions">Dimensões</TabsTrigger>
          <TabsTrigger value="notes">Notas</TabsTrigger>
        </TabsList>
      </Tabs>

      <div
        className={tab === 'basic' ? 'flex flex-col gap-6' : 'hidden'}
        aria-hidden={tab !== 'basic'}
      >
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="productName" required>
              Nome
            </Label>
            <Input
              id="productName"
              aria-invalid={errors.name ? true : undefined}
              placeholder="Ex.: Notebook Pro 14"
              {...register('name')}
            />
            {errors.name ? (
              <p className="text-xs text-feedback-danger-fg">{errors.name.message}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="productSku" required>
              SKU
            </Label>
            <Input
              id="productSku"
              aria-invalid={errors.sku ? true : undefined}
              placeholder="Ex.: NB-PRO-14"
              className="font-mono"
              {...register('sku')}
            />
            {errors.sku ? (
              <p className="text-xs text-feedback-danger-fg">{errors.sku.message}</p>
            ) : (
              <p className="text-xs text-text-secondary">
                Apenas letras, números, hífen e underscore. Único por organização.
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="productCategory">Categoria</Label>
            <Controller
              control={control}
              name="category_id"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="productCategory">
                    <SelectValue placeholder="Selecione uma categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CATEGORY_NONE}>Sem categoria</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="productBrand">Marca</Label>
            <Input
              id="productBrand"
              aria-invalid={errors.brand ? true : undefined}
              placeholder="Ex.: AxonTech"
              {...register('brand')}
            />
            {errors.brand ? (
              <p className="text-xs text-feedback-danger-fg">{errors.brand.message}</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="productShortDescription">Resumo</Label>
          <Input
            id="productShortDescription"
            aria-invalid={errors.short_description ? true : undefined}
            placeholder="Frase curta que aparece nas listagens"
            {...register('short_description')}
          />
          {errors.short_description ? (
            <p className="text-xs text-feedback-danger-fg">
              {errors.short_description.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="productDescription">Descrição</Label>
          <Textarea
            id="productDescription"
            rows={5}
            aria-invalid={errors.description ? true : undefined}
            placeholder="Descrição completa do produto, especificações, diferenciais."
            {...register('description')}
          />
          {errors.description ? (
            <p className="text-xs text-feedback-danger-fg">
              {errors.description.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="productTags">Tags</Label>
          <Input
            id="productTags"
            aria-invalid={errors.tags ? true : undefined}
            placeholder="Separe por vírgula — ex.: notebook, 14 polegadas, premium"
            {...register('tags')}
          />
          {errors.tags ? (
            <p className="text-xs text-feedback-danger-fg">{errors.tags.message}</p>
          ) : (
            <p className="text-xs text-text-secondary">
              Até 20 tags, cada uma com no máximo 30 caracteres.
            </p>
          )}
        </div>
      </div>

      <div
        className={tab === 'commercial' ? 'flex flex-col gap-6' : 'hidden'}
        aria-hidden={tab !== 'commercial'}
      >
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="productPrice">Preço (R$)</Label>
            <Input
              id="productPrice"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0,00"
              aria-invalid={errors.price ? true : undefined}
              {...register('price')}
            />
            {errors.price ? (
              <p className="text-xs text-feedback-danger-fg">{errors.price.message}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="productStock">Estoque</Label>
            <Input
              id="productStock"
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              placeholder="0"
              aria-invalid={errors.stock ? true : undefined}
              {...register('stock')}
            />
            {errors.stock ? (
              <p className="text-xs text-feedback-danger-fg">{errors.stock.message}</p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border bg-surface-raised px-4 py-3">
          <div className="flex flex-col">
            <Label htmlFor="productActive">Produto ativo</Label>
            <p className="text-xs text-text-secondary">
              Produtos arquivados ficam ocultos da listagem padrão.
            </p>
          </div>
          <Controller
            control={control}
            name="active"
            render={({ field }) => (
              <Switch
                id="productActive"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </div>
      </div>

      <div
        className={tab === 'dimensions' ? 'flex flex-col gap-6' : 'hidden'}
        aria-hidden={tab !== 'dimensions'}
      >
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="productWeight">Peso (kg)</Label>
            <Input
              id="productWeight"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0"
              aria-invalid={errors.weight ? true : undefined}
              {...register('weight')}
            />
            {errors.weight ? (
              <p className="text-xs text-feedback-danger-fg">{errors.weight.message}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="productHeight">Altura (cm)</Label>
            <Input
              id="productHeight"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.1"
              placeholder="0"
              aria-invalid={errors.height ? true : undefined}
              {...register('height')}
            />
            {errors.height ? (
              <p className="text-xs text-feedback-danger-fg">{errors.height.message}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="productWidth">Largura (cm)</Label>
            <Input
              id="productWidth"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.1"
              placeholder="0"
              aria-invalid={errors.width ? true : undefined}
              {...register('width')}
            />
            {errors.width ? (
              <p className="text-xs text-feedback-danger-fg">{errors.width.message}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="productDepth">Profundidade (cm)</Label>
            <Input
              id="productDepth"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.1"
              placeholder="0"
              aria-invalid={errors.depth ? true : undefined}
              {...register('depth')}
            />
            {errors.depth ? (
              <p className="text-xs text-feedback-danger-fg">{errors.depth.message}</p>
            ) : null}
          </div>
        </div>
      </div>

      <div
        className={tab === 'notes' ? 'flex flex-col gap-6' : 'hidden'}
        aria-hidden={tab !== 'notes'}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="productNotes">Notas internas</Label>
          <Textarea
            id="productNotes"
            rows={6}
            aria-invalid={errors.notes ? true : undefined}
            placeholder="Anotações privadas da equipe sobre este produto."
            {...register('notes')}
          />
          {errors.notes ? (
            <p className="text-xs text-feedback-danger-fg">{errors.notes.message}</p>
          ) : (
            <p className="text-xs text-text-secondary">
              Visível apenas para a equipe interna. Até 2000 caracteres.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-border-subtle pt-6">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push('/products')}
          disabled={isPending}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={isPending || (mode === 'edit' && !isDirty)}>
          {isPending
            ? 'Salvando…'
            : mode === 'create'
              ? 'Criar produto'
              : 'Salvar alterações'}
        </Button>
      </div>
    </form>
  );
}
