'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { assertRole } from '@/lib/actions/_shared/assertRole';
import { enforceLimit } from '@/lib/limits/enforceLimit';
import { buildStoragePath } from '@/lib/storage/paths';
import { getSessionContext } from '@/lib/supabase/getSessionContext';
import { createClient } from '@/lib/supabase/server';

interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ProductImageRow {
  id: string;
  product_id: string;
  url: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  position: number | null;
  is_primary: boolean | null;
  created_at: string | null;
  uploaded_by: string | null;
}

const IMAGE_BUCKET = 'products' as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES_PER_PRODUCT = 20;
const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const ReorderSchema = z.object({
  productId: z.string().uuid('Produto inválido'),
  orderedIds: z
    .array(z.string().uuid('ID de imagem inválido'))
    .min(1, 'Informe ao menos uma imagem')
    .max(MAX_IMAGES_PER_PRODUCT, `Máximo de ${MAX_IMAGES_PER_PRODUCT} imagens`),
});

const IMAGE_SELECT =
  'id, product_id, url, file_name, file_size, mime_type, position, is_primary, created_at, uploaded_by';

export async function uploadProductImageAction(
  productId: string,
  formData: FormData
): Promise<ActionResponse<ProductImageRow>> {
  const idParsed = z.string().uuid('Produto inválido').safeParse(productId);
  if (!idParsed.success) {
    return { success: false, error: idParsed.error.issues[0].message };
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return { success: false, error: 'Arquivo não recebido.' };
  }

  const mimeType = file.type;
  if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return {
      success: false,
      error: 'Formato não suportado. Use JPEG, PNG ou WebP.',
    };
  }

  if (file.size <= 0) {
    return { success: false, error: 'Arquivo vazio.' };
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return { success: false, error: 'Imagem excede o tamanho máximo de 5MB.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id')
      .eq('id', idParsed.data)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle<{ id: string }>();

    if (productError) {
      console.error('[product-images:upload:product-lookup]', productError);
      return { success: false, error: 'Não foi possível validar o produto.' };
    }
    if (!product) {
      return { success: false, error: 'Produto não encontrado.' };
    }

    const { data: existing, error: existingError } = await supabase
      .from('product_images')
      .select('id, position', { count: 'exact' })
      .eq('product_id', idParsed.data)
      .order('position', { ascending: false })
      .limit(1);

    if (existingError) {
      console.error('[product-images:upload:count]', existingError);
      return { success: false, error: 'Não foi possível listar as imagens do produto.' };
    }

    const { count: currentCount } = await supabase
      .from('product_images')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', idParsed.data);

    const total = currentCount ?? 0;
    if (total >= MAX_IMAGES_PER_PRODUCT) {
      return {
        success: false,
        error: `Limite de ${MAX_IMAGES_PER_PRODUCT} imagens por produto atingido.`,
      };
    }

    const enforced = await enforceLimit({
      organizationId: ctx.organizationId,
      limitKey: 'storage_mb',
      delta: Math.ceil(file.size / 1048576),
    });
    if (!enforced.ok) {
      return { success: false, error: enforced.error };
    }

    const nextPosition = (existing?.[0]?.position ?? -1) + 1;
    const isPrimary = total === 0;

    const storagePath = buildStoragePath({
      orgId: ctx.organizationId,
      productId: idParsed.data,
      fileName: file.name || 'image',
    });

    const { error: uploadError } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(storagePath, file, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error('[product-images:upload:storage]', uploadError);
      return { success: false, error: 'Falha ao enviar imagem. Tente novamente.' };
    }

    const { data: inserted, error: insertError } = await supabase
      .from('product_images')
      .insert({
        product_id: idParsed.data,
        url: storagePath,
        file_name: file.name || 'image',
        file_size: file.size,
        mime_type: mimeType,
        position: nextPosition,
        is_primary: isPrimary,
        uploaded_by: ctx.userId,
      })
      .select(IMAGE_SELECT)
      .single<ProductImageRow>();

    if (insertError || !inserted) {
      console.error('[product-images:upload:insert]', insertError);
      const cleanup = await supabase.storage.from(IMAGE_BUCKET).remove([storagePath]);
      if (cleanup.error) {
        console.error('[product-images:upload:cleanup-failed]', {
          path: storagePath,
          error: cleanup.error,
        });
      }
      return { success: false, error: 'Falha ao salvar imagem. Tente novamente.' };
    }

    revalidatePath(`/products/${idParsed.data}`);
    return { success: true, data: inserted };
  } catch (error) {
    console.error('[product-images:upload] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function deleteProductImageAction(
  imageId: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(imageId);
  if (!parsed.success) {
    return { success: false, error: 'Imagem não encontrada.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();

    const { data: image, error: readError } = await supabase
      .from('product_images')
      .select('id, product_id, url, is_primary, products!inner(organization_id)')
      .eq('id', parsed.data)
      .maybeSingle<{
        id: string;
        product_id: string;
        url: string;
        is_primary: boolean | null;
        products: { organization_id: string } | { organization_id: string }[] | null;
      }>();

    if (readError) {
      console.error('[product-images:delete:read]', readError);
      return { success: false, error: 'Não foi possível localizar a imagem.' };
    }
    if (!image) {
      return { success: false, error: 'Imagem não encontrada.' };
    }

    const productOrg = Array.isArray(image.products)
      ? image.products[0]?.organization_id
      : image.products?.organization_id;
    if (productOrg !== ctx.organizationId) {
      return { success: false, error: 'Imagem não encontrada.' };
    }

    const { error: deleteError } = await supabase
      .from('product_images')
      .delete()
      .eq('id', parsed.data);

    if (deleteError) {
      console.error('[product-images:delete]', deleteError);
      return { success: false, error: 'Não foi possível excluir a imagem.' };
    }

    if (image.is_primary) {
      const { data: next } = await supabase
        .from('product_images')
        .select('id')
        .eq('product_id', image.product_id)
        .order('position', { ascending: true })
        .limit(1)
        .maybeSingle<{ id: string }>();

      if (next) {
        const { error: promoteError } = await supabase
          .from('product_images')
          .update({ is_primary: true })
          .eq('id', next.id);
        if (promoteError) {
          console.error('[product-images:delete:promote]', promoteError);
        }
      }
    }

    const { error: storageError } = await supabase.storage
      .from(IMAGE_BUCKET)
      .remove([image.url]);
    if (storageError) {
      console.error('[product-images:delete:cleanup-failed]', {
        imageId: parsed.data,
        path: image.url,
        error: storageError,
      });
    }

    revalidatePath(`/products/${image.product_id}`);
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[product-images:delete] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function setPrimaryImageAction(
  imageId: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(imageId);
  if (!parsed.success) {
    return { success: false, error: 'Imagem não encontrada.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();

    const { data: owner, error: ownerError } = await supabase
      .from('product_images')
      .select('product_id, products!inner(id, organization_id)')
      .eq('id', parsed.data)
      .maybeSingle<{
        product_id: string;
        products:
          | { id: string; organization_id: string }
          | { id: string; organization_id: string }[]
          | null;
      }>();

    if (ownerError) {
      console.error('[product-images:set-primary:read]', ownerError);
      return { success: false, error: 'Não foi possível atualizar a capa.' };
    }
    const ownerOrg = Array.isArray(owner?.products)
      ? owner?.products[0]?.organization_id
      : owner?.products?.organization_id;
    if (!owner || ownerOrg !== ctx.organizationId) {
      return { success: false, error: 'Imagem não encontrada.' };
    }

    const { error: rpcError } = await supabase.rpc('set_product_image_primary', {
      p_image_id: parsed.data,
    });

    if (rpcError) {
      console.error('[product-images:set-primary]', rpcError);
      return { success: false, error: 'Não foi possível atualizar a capa.' };
    }

    revalidatePath(`/products/${owner.product_id}`);
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[product-images:set-primary] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function reorderProductImagesAction(
  productId: string,
  orderedIds: string[]
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = ReorderSchema.safeParse({ productId, orderedIds });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id')
      .eq('id', parsed.data.productId)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle<{ id: string }>();

    if (productError) {
      console.error('[product-images:reorder:product-lookup]', productError);
      return { success: false, error: 'Não foi possível reordenar as imagens.' };
    }
    if (!product) {
      return { success: false, error: 'Produto não encontrado.' };
    }

    const { error: rpcError } = await supabase.rpc('reorder_product_images', {
      p_product_id: parsed.data.productId,
      p_ordered_ids: parsed.data.orderedIds,
    });

    if (rpcError) {
      console.error('[product-images:reorder]', rpcError);
      const message = rpcError.message?.includes('INVALID_IMAGE_IDS')
        ? 'IDs de imagens inválidos para este produto.'
        : 'Não foi possível reordenar as imagens.';
      return { success: false, error: message };
    }

    revalidatePath(`/products/${parsed.data.productId}`);
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[product-images:reorder] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
