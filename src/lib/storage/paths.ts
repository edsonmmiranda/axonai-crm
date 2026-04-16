import 'server-only';

import { randomUUID } from 'node:crypto';

export function sanitizeFilename(name: string): string {
  const decomposed = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const lower = decomposed.toLowerCase();
  const dashed = lower.replace(/\s+/g, '-');
  const cleaned = dashed.replace(/[^a-z0-9._-]/g, '-');
  const collapsed = cleaned.replace(/-+/g, '-');
  const trimmed = collapsed.replace(/^[-._]+|[-._]+$/g, '');
  return trimmed || 'file';
}

export function buildStoragePath(input: {
  orgId: string;
  productId: string;
  fileName: string;
}): string {
  const safe = sanitizeFilename(input.fileName);
  const uid = randomUUID();
  return `${input.orgId}/${input.productId}/${uid}-${safe}`;
}
