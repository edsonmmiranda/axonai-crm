export const WHATSAPP_GROUP_SORT_KEYS = [
  'name',
  'description',
  'whatsapp_id',
  'is_active',
  'created_at',
] as const;
export type WhatsappGroupSortKey = (typeof WHATSAPP_GROUP_SORT_KEYS)[number];
export type WhatsappGroupSortDir = 'asc' | 'desc';
export interface WhatsappGroupSortRule {
  key: WhatsappGroupSortKey;
  dir: WhatsappGroupSortDir;
}
