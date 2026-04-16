import 'server-only';

import { createClient } from '@/lib/supabase/server';

export type StorageBucket = 'products' | 'product-documents';

export async function getSignedUrlsBatch(
  bucket: StorageBucket,
  paths: string[],
  expiresIn = 3600
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  if (paths.length === 0) return result;

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(paths, expiresIn);

  if (error || !data) {
    console.error('[storage:signed-urls-batch]', { bucket, count: paths.length, error });
    for (const p of paths) result[p] = null;
    return result;
  }

  for (const entry of data) {
    result[entry.path ?? ''] = entry.signedUrl ?? null;
  }
  for (const p of paths) {
    if (!(p in result)) result[p] = null;
  }
  return result;
}

export async function getSignedUrl(
  bucket: StorageBucket,
  path: string,
  expiresIn = 3600
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    console.error('[storage:signed-url]', { bucket, path, error });
    return null;
  }
  return data.signedUrl;
}
