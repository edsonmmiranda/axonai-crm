export const LEAD_ORIGIN_SORT_KEYS = [
  'name',
  'type',
  'platform',
  'is_active',
  'created_at',
] as const;
export type LeadOriginSortKey = (typeof LEAD_ORIGIN_SORT_KEYS)[number];
export type LeadOriginSortDir = 'asc' | 'desc';
export interface LeadOriginSortRule {
  key: LeadOriginSortKey;
  dir: LeadOriginSortDir;
}
