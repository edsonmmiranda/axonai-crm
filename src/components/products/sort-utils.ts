import {
  PRODUCT_SORT_KEYS,
  type ProductSortKey,
  type ProductSortRule,
} from '@/lib/products/constants';

const VALID_KEYS = new Set<string>(PRODUCT_SORT_KEYS);

export function parseSortParam(value: string | null | undefined): ProductSortRule[] {
  if (!value) return [];
  const out: ProductSortRule[] = [];
  const seen = new Set<string>();
  for (const part of value.split(',')) {
    const [rawKey, rawDir] = part.split(':');
    const key = rawKey?.trim();
    const dir = (rawDir?.trim() ?? 'asc').toLowerCase();
    if (!key || !VALID_KEYS.has(key)) continue;
    if (dir !== 'asc' && dir !== 'desc') continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key: key as ProductSortKey, dir });
    if (out.length >= 6) break;
  }
  return out;
}

export function serializeSortParam(rules: ProductSortRule[]): string {
  return rules.map((r) => `${r.key}:${r.dir}`).join(',');
}

export const SORT_COLUMN_LABELS: Record<ProductSortKey, string> = {
  name: 'Nome',
  sku: 'SKU',
  price: 'Preço',
  stock: 'Estoque',
  status: 'Status',
  created_at: 'Criado em',
};
