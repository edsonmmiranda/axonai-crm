import {
  LEAD_ORIGIN_SORT_KEYS,
  type LeadOriginSortKey,
  type LeadOriginSortRule,
} from '@/lib/lead-origins/constants';

const VALID_KEYS = new Set<string>(LEAD_ORIGIN_SORT_KEYS);

export function parseSortParam(value: string | null | undefined): LeadOriginSortRule[] {
  if (!value) return [];
  const out: LeadOriginSortRule[] = [];
  const seen = new Set<string>();
  for (const part of value.split(',')) {
    const [rawKey, rawDir] = part.split(':');
    const key = rawKey?.trim();
    const dir = (rawDir?.trim() ?? 'asc').toLowerCase();
    if (!key || !VALID_KEYS.has(key)) continue;
    if (dir !== 'asc' && dir !== 'desc') continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key: key as LeadOriginSortKey, dir });
    if (out.length >= 6) break;
  }
  return out;
}

export function serializeSortParam(rules: LeadOriginSortRule[]): string {
  return rules.map((r) => `${r.key}:${r.dir}`).join(',');
}

export const SORT_COLUMN_LABELS: Record<LeadOriginSortKey, string> = {
  name: 'Nome',
  type: 'Tipo',
  platform: 'Plataforma',
  is_active: 'Status',
  created_at: 'Criado em',
};
