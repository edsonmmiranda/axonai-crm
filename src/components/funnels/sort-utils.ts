import {
  FUNNEL_SORT_KEYS,
  type FunnelSortKey,
  type FunnelSortRule,
} from '@/lib/funnels/constants';

const VALID_KEYS = new Set<string>(FUNNEL_SORT_KEYS);

export function parseSortParam(value: string | null | undefined): FunnelSortRule[] {
  if (!value) return [];
  const out: FunnelSortRule[] = [];
  const seen = new Set<string>();
  for (const part of value.split(',')) {
    const [rawKey, rawDir] = part.split(':');
    const key = rawKey?.trim();
    const dir = (rawDir?.trim() ?? 'asc').toLowerCase();
    if (!key || !VALID_KEYS.has(key)) continue;
    if (dir !== 'asc' && dir !== 'desc') continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key: key as FunnelSortKey, dir: dir as 'asc' | 'desc' });
    if (out.length >= 3) break;
  }
  return out;
}

export function serializeSortParam(rules: FunnelSortRule[]): string {
  return rules.map((r) => `${r.key}:${r.dir}`).join(',');
}

export const SORT_COLUMN_LABELS: Record<FunnelSortKey, string> = {
  name: 'Nome',
  is_active: 'Status',
  created_at: 'Criado em',
};
