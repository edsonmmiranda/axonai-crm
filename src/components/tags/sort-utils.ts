import {
  TAG_SORT_KEYS,
  type TagSortKey,
  type TagSortRule,
} from '@/lib/tags/constants';

const VALID_KEYS = new Set<string>(TAG_SORT_KEYS);

export function parseSortParam(value: string | null | undefined): TagSortRule[] {
  if (!value) return [];
  const out: TagSortRule[] = [];
  const seen = new Set<string>();
  for (const part of value.split(',')) {
    const [rawKey, rawDir] = part.split(':');
    const key = rawKey?.trim();
    const dir = (rawDir?.trim() ?? 'asc').toLowerCase();
    if (!key || !VALID_KEYS.has(key)) continue;
    if (dir !== 'asc' && dir !== 'desc') continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key: key as TagSortKey, dir });
    if (out.length >= 6) break;
  }
  return out;
}

export function serializeSortParam(rules: TagSortRule[]): string {
  return rules.map((r) => `${r.key}:${r.dir}`).join(',');
}

export const SORT_COLUMN_LABELS: Record<TagSortKey, string> = {
  name: 'Nome',
  color: 'Cor',
  is_active: 'Status',
  created_at: 'Criado em',
};
