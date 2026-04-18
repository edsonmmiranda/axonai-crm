export const LOSS_REASON_SORT_KEYS = [
  'name',
  'is_active',
  'created_at',
] as const;
export type LossReasonSortKey = (typeof LOSS_REASON_SORT_KEYS)[number];
export type LossReasonSortDir = 'asc' | 'desc';
export interface LossReasonSortRule {
  key: LossReasonSortKey;
  dir: LossReasonSortDir;
}
