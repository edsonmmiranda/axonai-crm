export const FUNNEL_SORT_KEYS = ['name', 'is_active', 'created_at'] as const;
export type FunnelSortKey = (typeof FUNNEL_SORT_KEYS)[number];
export type FunnelSortDir = 'asc' | 'desc';
export interface FunnelSortRule {
  key: FunnelSortKey;
  dir: FunnelSortDir;
}
