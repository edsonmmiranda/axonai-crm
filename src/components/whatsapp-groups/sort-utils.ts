import {
  WHATSAPP_GROUP_SORT_KEYS,
  type WhatsappGroupSortKey,
  type WhatsappGroupSortRule,
} from '@/lib/whatsapp-groups/constants';

const VALID_KEYS = new Set<string>(WHATSAPP_GROUP_SORT_KEYS);

export function parseSortParam(value: string | null | undefined): WhatsappGroupSortRule[] {
  if (!value) return [];
  const out: WhatsappGroupSortRule[] = [];
  const seen = new Set<string>();
  for (const part of value.split(',')) {
    const [rawKey, rawDir] = part.split(':');
    const key = rawKey?.trim();
    const dir = (rawDir?.trim() ?? 'asc').toLowerCase();
    if (!key || !VALID_KEYS.has(key)) continue;
    if (dir !== 'asc' && dir !== 'desc') continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key: key as WhatsappGroupSortKey, dir: dir as 'asc' | 'desc' });
    if (out.length >= 6) break;
  }
  return out;
}

export function serializeSortParam(rules: WhatsappGroupSortRule[]): string {
  return rules.map((r) => `${r.key}:${r.dir}`).join(',');
}

export const SORT_COLUMN_LABELS: Record<WhatsappGroupSortKey, string> = {
  name: 'Nome',
  description: 'Descrição',
  whatsapp_id: 'WhatsApp ID',
  is_active: 'Status',
  created_at: 'Criado em',
};
