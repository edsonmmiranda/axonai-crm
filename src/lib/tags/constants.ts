export const TAG_SORT_KEYS = [
  'name',
  'color',
  'is_active',
  'created_at',
] as const;
export type TagSortKey = (typeof TAG_SORT_KEYS)[number];
export type TagSortDir = 'asc' | 'desc';
export interface TagSortRule {
  key: TagSortKey;
  dir: TagSortDir;
}

export const TAG_COLORS = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
] as const;
export type TagColor = (typeof TAG_COLORS)[number];
