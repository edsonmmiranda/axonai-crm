'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { assertRole } from '@/lib/actions/_shared/assertRole';
import { buildStoragePath } from '@/lib/storage/paths';
import { getSignedUrl } from '@/lib/storage/signed-urls';
import { getSessionContext } from '@/lib/supabase/getSessionContext';
import { createClient } from '@/lib/supabase/server';

interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ProductDocumentRow {
  id: string;
  product_id: string;
  url: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  document_type: string | null;
  created_at: string | null;
  uploaded_by: string | null;
}

const DOCUMENT_BUCKET = 'product-documents' as const;
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_DOCUMENTS_PER_PRODUCT = 50;
const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
] as const;

const DocumentTypeSchema = z
  .string()
  .trim()
  .max(50, 'Tipo deve ter no máximo 50 caracteres')
  .optional()
  .or(z.literal('').transform(() => undefined));

const DOCUMENT_SELECT =
  'id, product_id, url, file_name, file_size, mime_type, document_type, created_at, uploaded_by';

const DOWNLOAD_SIGNED_URL_TTL_SECONDS = 600;

export async function uploadProductDocumentAction(
  productId: string,
  formData: FormData,
  documentType?: string
): Promise<ActionResponse<ProductDocumentRow>> {
  const idParsed = z.string().uuid('Produto inválido').safeParse(productId);
  if (!idParsed.success) {
    return { success: false, error: idParsed.error.issues[0].message };
  }

  const typeParsed = DocumentTypeSchema.safeParse(documentType);
  if (!typeParsed.success) {
    return { success: false, error: typeParsed.error.issues[0].message };
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return { success: false, error: 'Arquivo não recebido.' };
  }

  const mimeType = file.type;
  if (!(ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return {
      success: false,
      error: 'Formato não suportado. Use PDF, DOC, DOCX, JPEG ou PNG.',
    };
  }

  if (file.size <= 0) {
    return { success: false, error: 'Arquivo vazio.' };
  }

  if (file.size > MAX_DOCUMENT_BYTES) {
    return { success: false, error: 'Documento excede o tamanho máximo de 20MB.' };
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
      console.error('[product-documents:upload:product-lookup]', productError);
      return { success: false, error: 'Não foi possível validar o produto.' };
    }
    if (!product) {
      return { success: false, error: 'Produto não encontrado.' };
    }

    const { count: currentCount } = await supabase
      .from('product_documents')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', idParsed.data);

    if ((currentCount ?? 0) >= MAX_DOCUMENTS_PER_PRODUCT) {
      return {
        success: false,
        error: `Limite de ${MAX_DOCUMENTS_PER_PRODUCT} documentos por produto atingido.`,
      };
    }

    const storagePath = buildStoragePath({
      orgId: ctx.organizationId,
      productId: idParsed.data,
      fileName: file.name || 'document',
    });

    const { error: uploadError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .upload(storagePath, file, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error('[product-documents:upload:storage]', uploadError);
      return { success: false, error: 'Falha ao enviar documento. Tente novamente.' };
    }

    const { data: inserted, error: insertError } = await supabase
      .from('product_documents')
      .insert({
        product_id: idParsed.data,
        url: storagePath,
        file_name: file.name || 'document',
        file_size: file.size,
        mime_type: mimeType,
        document_type: typeParsed.data ?? null,
        uploaded_by: ctx.userId,
      })
      .select(DOCUMENT_SELECT)
      .single<ProductDocumentRow>();

    if (insertError || !inserted) {
      console.error('[product-documents:upload:insert]', insertError);
      const cleanup = await supabase.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
      if (cleanup.error) {
        console.error('[product-documents:upload:cleanup-failed]', {
          path: storagePath,
          error: cleanup.error,
        });
      }
      return { success: false, error: 'Falha ao salvar documento. Tente novamente.' };
    }

    revalidatePath(`/products/${idParsed.data}`);
    return { success: true, data: inserted };
  } catch (error) {
    console.error('[product-documents:upload] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function deleteProductDocumentAction(
  documentId: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(documentId);
  if (!parsed.success) {
    return { success: false, error: 'Documento não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();

    const { data: doc, error: readError } = await supabase
      .from('product_documents')
      .select('id, product_id, url, products!inner(organization_id)')
      .eq('id', parsed.data)
      .maybeSingle<{
        id: string;
        product_id: string;
        url: string;
        products: { organization_id: string } | { organization_id: string }[] | null;
      }>();

    if (readError) {
      console.error('[product-documents:delete:read]', readError);
      return { success: false, error: 'Não foi possível localizar o documento.' };
    }
    if (!doc) {
      return { success: false, error: 'Documento não encontrado.' };
    }

    const productOrg = Array.isArray(doc.products)
      ? doc.products[0]?.organization_id
      : doc.products?.organization_id;
    if (productOrg !== ctx.organizationId) {
      return { success: false, error: 'Documento não encontrado.' };
    }

    const { error: deleteError } = await supabase
      .from('product_documents')
      .delete()
      .eq('id', parsed.data);

    if (deleteError) {
      console.error('[product-documents:delete]', deleteError);
      return { success: false, error: 'Não foi possível excluir o documento.' };
    }

    const { error: storageError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .remove([doc.url]);
    if (storageError) {
      console.error('[product-documents:delete:cleanup-failed]', {
        documentId: parsed.data,
        path: doc.url,
        error: storageError,
      });
    }

    revalidatePath(`/products/${doc.product_id}`);
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[product-documents:delete] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function getProductDocumentSignedUrlAction(
  documentId: string
): Promise<ActionResponse<{ url: string; fileName: string }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(documentId);
  if (!parsed.success) {
    return { success: false, error: 'Documento não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { data: doc, error: readError } = await supabase
      .from('product_documents')
      .select('id, url, file_name, products!inner(organization_id)')
      .eq('id', parsed.data)
      .maybeSingle<{
        id: string;
        url: string;
        file_name: string;
        products: { organization_id: string } | { organization_id: string }[] | null;
      }>();

    if (readError) {
      console.error('[product-documents:signed-url:read]', readError);
      return { success: false, error: 'Não foi possível gerar link de download.' };
    }
    if (!doc) {
      return { success: false, error: 'Documento não encontrado.' };
    }

    const productOrg = Array.isArray(doc.products)
      ? doc.products[0]?.organization_id
      : doc.products?.organization_id;
    if (productOrg !== ctx.organizationId) {
      return { success: false, error: 'Documento não encontrado.' };
    }

    const signedUrl = await getSignedUrl(
      DOCUMENT_BUCKET,
      doc.url,
      DOWNLOAD_SIGNED_URL_TTL_SECONDS
    );

    if (!signedUrl) {
      return { success: false, error: 'Não foi possível gerar link de download.' };
    }

    return {
      success: true,
      data: { url: signedUrl, fileName: doc.file_name },
    };
  } catch (error) {
    console.error('[product-documents:signed-url] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
