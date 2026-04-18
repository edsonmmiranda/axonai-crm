import {
  LOSS_REASON_SORT_KEYS,
  type LossReasonSortKey,
  type LossReasonSortRule,
} from '@/lib/loss-reasons/constants';

const VALID_KEYS = new Set<string>(LOSS_REASON_SORT_KEYS);

export function parseSortParam(value: string | null | undefined): LossReasonSortRule[] {
  if (!value) return [];
  const out: LossReasonSortRule[] = [];
  const seen = new Set<string>();
  for (const part of value.split(',')) {
    const [rawKey, rawDir] = part.split(':');
    const key = rawKey?.trim();
    const dir = (rawDir?.trim() ?? 'asc').toLowerCase();
    if (!key || !VALID_KEYS.has(key)) continue;
    if (dir !== 'asc' && dir !== 'desc') continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key: key as LossReasonSortKey, dir });
    if (out.length >= 6) break;
  }
  return out;
}

export function serializeSortParam(rules: LossReasonSortRule[]): string {
  return rules.map((r) => `${r.key}:${r.dir}`).join(',');
}

export const SORT_COLUMN_LABELS: Record<LossReasonSortKey, string> = {
  name: 'Nome',
  is_active: 'Status',
  created_at: 'Criado em',
};
