export const PRODUCT_PAGE_SIZES = [10, 20, 50, 100, 500, 1000] as const;
export type ProductPageSize = (typeof PRODUCT_PAGE_SIZES)[number];

export const PRODUCT_SORT_KEYS = [
  'name',
  'sku',
  'price',
  'stock',
  'status',
  'created_at',
] as const;
export type ProductSortKey = (typeof PRODUCT_SORT_KEYS)[number];
export type ProductSortDir = 'asc' | 'desc';
export interface ProductSortRule {
  key: ProductSortKey;
  dir: ProductSortDir;
}

export type ProductStatus = 'active' | 'archived';
