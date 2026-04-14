'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { ActionResponse } from '@/types/action-response';
import {
  ItemInputSchema,
  ItemIdSchema,
  ListItemsParamsSchema,
  type Item,
  type ListItemsParams,
} from '@/lib/validators/item';

type ListResult = { items: Item[] };

export async function createItemAction(
  input: unknown
): Promise<ActionResponse<Item>> {
  try {
    const parsed = ItemInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Input inválido' };
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Não autenticado' };

    const { data, error } = await supabase
      .from('items')
      .insert({ ...parsed.data, user_id: user.id })
      .select()
      .single();

    if (error) {
      console.error('[createItemAction]', error);
      return { success: false, error: 'Não foi possível criar o registro' };
    }

    revalidatePath('/items');
    return { success: true, data: data as Item };
  } catch (err) {
    console.error('[createItemAction] unexpected', err);
    return { success: false, error: 'Erro inesperado' };
  }
}

export async function updateItemAction(
  id: string,
  input: unknown
): Promise<ActionResponse<Item>> {
  try {
    const idParsed = ItemIdSchema.safeParse({ id });
    if (!idParsed.success) return { success: false, error: 'ID inválido' };

    const parsed = ItemInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Input inválido' };
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Não autenticado' };

    const { data, error } = await supabase
      .from('items')
      .update(parsed.data)
      .eq('id', idParsed.data.id)
      .select()
      .single();

    if (error) {
      console.error('[updateItemAction]', error);
      return { success: false, error: 'Não foi possível atualizar o registro' };
    }

    revalidatePath('/items');
    revalidatePath(`/items/${idParsed.data.id}/edit`);
    return { success: true, data: data as Item };
  } catch (err) {
    console.error('[updateItemAction] unexpected', err);
    return { success: false, error: 'Erro inesperado' };
  }
}

export async function deleteItemAction(
  id: string
): Promise<ActionResponse<{ id: string }>> {
  try {
    const idParsed = ItemIdSchema.safeParse({ id });
    if (!idParsed.success) return { success: false, error: 'ID inválido' };

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Não autenticado' };

    const { error } = await supabase
      .from('items')
      .delete()
      .eq('id', idParsed.data.id);

    if (error) {
      console.error('[deleteItemAction]', error);
      return { success: false, error: 'Não foi possível excluir o registro' };
    }

    revalidatePath('/items');
    return { success: true, data: { id: idParsed.data.id } };
  } catch (err) {
    console.error('[deleteItemAction] unexpected', err);
    return { success: false, error: 'Erro inesperado' };
  }
}

export async function getItemByIdAction(
  id: string
): Promise<ActionResponse<Item>> {
  try {
    const idParsed = ItemIdSchema.safeParse({ id });
    if (!idParsed.success) return { success: false, error: 'ID inválido' };

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Não autenticado' };

    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('id', idParsed.data.id)
      .single();

    if (error || !data) {
      console.error('[getItemByIdAction]', error);
      return { success: false, error: 'Registro não encontrado' };
    }

    return { success: true, data: data as Item };
  } catch (err) {
    console.error('[getItemByIdAction] unexpected', err);
    return { success: false, error: 'Erro inesperado' };
  }
}

export async function getItemsAction(
  rawParams: Partial<ListItemsParams> = {}
): Promise<ActionResponse<ListResult>> {
  try {
    const parsed = ListItemsParamsSchema.safeParse(rawParams);
    if (!parsed.success) {
      return { success: false, error: 'Parâmetros inválidos' };
    }
    const { page, itemsPerPage, search, sort, order } = parsed.data;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Não autenticado' };

    const from = (page - 1) * itemsPerPage;
    const to = from + itemsPerPage - 1;

    let query = supabase
      .from('items')
      .select('id, user_id, name, description, created_at, updated_at', { count: 'exact' })
      .range(from, to)
      .order(sort, { ascending: order === 'asc' });

    if (search) query = query.ilike('name', `%${search}%`);

    const { data, error, count } = await query;
    if (error) {
      console.error('[getItemsAction]', error);
      return { success: false, error: 'Não foi possível listar os registros' };
    }

    const total = count ?? 0;
    return {
      success: true,
      data: { items: (data ?? []) as Item[] },
      metadata: {
        total,
        totalPages: Math.max(1, Math.ceil(total / itemsPerPage)),
        currentPage: page,
        itemsPerPage,
      },
    };
  } catch (err) {
    console.error('[getItemsAction] unexpected', err);
    return { success: false, error: 'Erro inesperado' };
  }
}
