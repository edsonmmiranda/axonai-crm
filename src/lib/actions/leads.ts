'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { assertRole } from '@/lib/actions/_shared/assertRole';
import { getSessionContext } from '@/lib/supabase/getSessionContext';
import { createClient } from '@/lib/supabase/server';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: PaginationMeta;
}

interface PaginationMeta {
  total: number;
  totalPages: number;
  currentPage: number;
  itemsPerPage: number;
}

export interface LeadTag {
  id: string;
  name: string;
  color: string;
}

export interface LeadRow {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  medium: string | null;
  campaign: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  company: string | null;
  position: string | null;
  notes: string | null;
  status: string;
  score: number;
  value: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  assigned_to: string | null;
  origin_id: string | null;
  is_active: boolean;
  loss_reason_id: string | null;
  loss_notes: string | null;
  origin_name: string | null;
  assigned_to_name: string | null;
  tags: LeadTag[];
}

export type LeadDetail = LeadRow;

export interface OriginOption {
  id: string;
  name: string;
}

export interface LossReasonOption {
  id: string;
  name: string;
}

export interface ProfileOption {
  id: string;
  full_name: string;
}

export interface TagOption {
  id: string;
  name: string;
  color: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const LEAD_STATUS_VALUES = [
  'new',
  'contacted',
  'qualified',
  'proposal',
  'negotiation',
  'won',
  'lost',
] as const;

export type LeadStatus = (typeof LEAD_STATUS_VALUES)[number];

const LEADS_BASE_COLUMNS =
  'id, organization_id, name, email, phone, medium, campaign, utm_source, utm_medium, utm_campaign, utm_content, utm_term, company, position, notes, status, score, value, created_at, updated_at, created_by, assigned_to, origin_id, loss_reason_id, loss_notes, is_active' as const;

/* ------------------------------------------------------------------ */
/*  Zod Schemas                                                        */
/* ------------------------------------------------------------------ */

const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .pipe(z.string().optional());

const optionalUuid = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .pipe(z.string().uuid().optional());

const CreateLeadSchema = z.object({
  name: z.string().trim().min(2, 'Nome deve ter ao menos 2 caracteres').max(100, 'Nome deve ter no máximo 100 caracteres'),
  email: z.string().trim().transform((v) => (v === '' ? undefined : v)).pipe(z.string().email('Email inválido').optional()),
  phone: z.string().trim().transform((v) => (v === '' ? undefined : v)).pipe(z.string().min(8, 'Telefone deve ter ao menos 8 caracteres').max(20, 'Telefone deve ter no máximo 20 caracteres').optional()),
  company: optionalString.pipe(z.string().max(100, 'Empresa deve ter no máximo 100 caracteres').optional()),
  position: optionalString.pipe(z.string().max(100, 'Cargo deve ter no máximo 100 caracteres').optional()),
  notes: optionalString.pipe(z.string().max(2000, 'Notas devem ter no máximo 2000 caracteres').optional()),
  status: z.enum(LEAD_STATUS_VALUES).optional().default('new'),
  score: z.number().int().min(0).max(100).optional().default(0),
  value: z.number().min(0).optional().default(0),
  medium: optionalString.pipe(z.string().max(100).optional()),
  campaign: optionalString.pipe(z.string().max(100).optional()),
  utm_source: optionalString.pipe(z.string().max(200).optional()),
  utm_medium: optionalString.pipe(z.string().max(200).optional()),
  utm_campaign: optionalString.pipe(z.string().max(200).optional()),
  utm_content: optionalString.pipe(z.string().max(200).optional()),
  utm_term: optionalString.pipe(z.string().max(200).optional()),
  origin_id: optionalUuid,
  assigned_to: optionalUuid,
  is_active: z.boolean().optional().default(true),
  tagIds: z.array(z.string().uuid()).optional().default([]),
});

const UpdateLeadSchema = CreateLeadSchema;

const MarkAsLostSchema = z.object({
  lossReasonId: z.string().uuid('Motivo de perda obrigatório'),
  lossNotes: optionalString.pipe(z.string().max(500, 'Notas de perda devem ter no máximo 500 caracteres').optional()),
});

const UpdateStatusSchema = z.object({
  status: z.enum(LEAD_STATUS_VALUES),
});

const AssignLeadSchema = z.object({
  assignedTo: z.string().uuid('Responsável inválido'),
});

const ListLeadsSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(LEAD_STATUS_VALUES).optional(),
  originId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
  sortBy: z.string().optional().default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export type CreateLeadInput = z.input<typeof CreateLeadSchema>;
export type UpdateLeadInput = z.input<typeof UpdateLeadSchema>;
export type ListLeadsInput = z.input<typeof ListLeadsSchema>;
export type MarkAsLostInput = z.input<typeof MarkAsLostSchema>;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function loadLeadTags(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leadIds: string[]
): Promise<Map<string, LeadTag[]>> {
  if (leadIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('lead_tags')
    .select('lead_id, tags(id, name, color)')
    .in('lead_id', leadIds);

  if (error || !data) return new Map();

  const map = new Map<string, LeadTag[]>();
  for (const row of data as unknown as Array<{ lead_id: string; tags: { id: string; name: string; color: string } | null }>) {
    if (!row.tags) continue;
    const existing = map.get(row.lead_id) ?? [];
    existing.push({ id: row.tags.id, name: row.tags.name, color: row.tags.color });
    map.set(row.lead_id, existing);
  }
  return map;
}

async function loadOriginNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  originIds: string[]
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(originIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const { data } = await supabase
    .from('lead_origins')
    .select('id, name')
    .in('id', uniqueIds);

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(row.id as string, row.name as string);
  }
  return map;
}

async function loadProfileNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileIds: string[]
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(profileIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const { data } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', uniqueIds);

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(row.id as string, row.full_name as string);
  }
  return map;
}

function enrichLeads(
  leads: Array<Record<string, unknown>>,
  tagsMap: Map<string, LeadTag[]>,
  originsMap: Map<string, string>,
  profilesMap: Map<string, string>
): LeadRow[] {
  return leads.map((lead) => ({
    id: lead.id as string,
    organization_id: lead.organization_id as string,
    name: lead.name as string,
    email: (lead.email as string | null) ?? null,
    phone: (lead.phone as string | null) ?? null,
    medium: (lead.medium as string | null) ?? null,
    campaign: (lead.campaign as string | null) ?? null,
    utm_source: (lead.utm_source as string | null) ?? null,
    utm_medium: (lead.utm_medium as string | null) ?? null,
    utm_campaign: (lead.utm_campaign as string | null) ?? null,
    utm_content: (lead.utm_content as string | null) ?? null,
    utm_term: (lead.utm_term as string | null) ?? null,
    company: (lead.company as string | null) ?? null,
    position: (lead.position as string | null) ?? null,
    notes: (lead.notes as string | null) ?? null,
    status: (lead.status as string) ?? 'new',
    score: (lead.score as number) ?? 0,
    value: Number(lead.value) ?? 0,
    created_at: lead.created_at as string,
    updated_at: lead.updated_at as string,
    created_by: (lead.created_by as string | null) ?? null,
    assigned_to: (lead.assigned_to as string | null) ?? null,
    origin_id: (lead.origin_id as string | null) ?? null,
    is_active: (lead.is_active as boolean) ?? true,
    loss_reason_id: (lead.loss_reason_id as string | null) ?? null,
    loss_notes: (lead.loss_notes as string | null) ?? null,
    origin_name: lead.origin_id ? originsMap.get(lead.origin_id as string) ?? null : null,
    assigned_to_name: lead.assigned_to ? profilesMap.get(lead.assigned_to as string) ?? null : null,
    tags: tagsMap.get(lead.id as string) ?? [],
  }));
}

/* ------------------------------------------------------------------ */
/*  CRUD Actions                                                       */
/* ------------------------------------------------------------------ */

export async function getLeadsAction(
  input: ListLeadsInput = {}
): Promise<ActionResponse<LeadRow[]>> {
  const parsed = ListLeadsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { search, status, originId, assignedTo, tagId, isActive, page, pageSize, sortBy, sortOrder } = parsed.data;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // If filtering by tag, first get matching lead IDs
    let tagLeadIds: string[] | null = null;
    if (tagId) {
      const { data: tagData } = await supabase
        .from('lead_tags')
        .select('lead_id')
        .eq('tag_id', tagId);
      tagLeadIds = (tagData ?? []).map((r) => r.lead_id as string);
      if (tagLeadIds.length === 0) {
        return {
          success: true,
          data: [],
          metadata: { total: 0, totalPages: 1, currentPage: page, itemsPerPage: pageSize },
        };
      }
    }

    let query = supabase
      .from('leads')
      .select(LEADS_BASE_COLUMNS, { count: 'exact' })
      .eq('organization_id', ctx.organizationId);

    // Filter by is_active: true = active only, false = inactive only, undefined = all
    if (typeof isActive === 'boolean') {
      query = query.eq('is_active', isActive);
    }

    if (status) {
      query = query.eq('status', status);
    }
    if (originId) {
      query = query.eq('origin_id', originId);
    }
    if (assignedTo) {
      query = query.eq('assigned_to', assignedTo);
    }
    if (tagLeadIds) {
      query = query.in('id', tagLeadIds);
    }
    if (search && search.length > 0) {
      query = query.or(
        `name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%,company.ilike.%${search}%`
      );
    }

    const validSortColumns = ['name', 'email', 'status', 'score', 'value', 'created_at'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
    query = query.order(sortColumn, { ascending: sortOrder === 'asc' });
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      console.error('[leads:list]', error);
      return { success: false, error: 'Não foi possível carregar os leads.' };
    }

    const leads = (data ?? []) as Array<Record<string, unknown>>;
    const leadIds = leads.map((l) => l.id as string);
    const originIds = leads.map((l) => l.origin_id as string).filter(Boolean);
    const profileIds = leads.map((l) => l.assigned_to as string).filter(Boolean);

    const [tagsMap, originsMap, profilesMap] = await Promise.all([
      loadLeadTags(supabase, leadIds),
      loadOriginNames(supabase, originIds),
      loadProfileNames(supabase, profileIds),
    ]);

    const total = count ?? 0;
    return {
      success: true,
      data: enrichLeads(leads, tagsMap, originsMap, profilesMap),
      metadata: {
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        currentPage: page,
        itemsPerPage: pageSize,
      },
    };
  } catch (error) {
    console.error('[leads:list] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function getLeadByIdAction(
  id: string
): Promise<ActionResponse<LeadDetail>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Lead não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('leads')
      .select(LEADS_BASE_COLUMNS)
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();

    if (error) {
      console.error('[leads:get]', error);
      return { success: false, error: 'Não foi possível carregar o lead.' };
    }
    if (!data) {
      return { success: false, error: 'Lead não encontrado.' };
    }

    const lead = data as Record<string, unknown>;
    const leadId = lead.id as string;

    const [tagsMap, originsMap, profilesMap] = await Promise.all([
      loadLeadTags(supabase, [leadId]),
      lead.origin_id ? loadOriginNames(supabase, [lead.origin_id as string]) : Promise.resolve(new Map<string, string>()),
      lead.assigned_to ? loadProfileNames(supabase, [lead.assigned_to as string]) : Promise.resolve(new Map<string, string>()),
    ]);

    const enriched = enrichLeads([lead], tagsMap, originsMap, profilesMap);
    return { success: true, data: enriched[0] };
  } catch (error) {
    console.error('[leads:get] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function createLeadAction(
  input: CreateLeadInput
): Promise<ActionResponse<LeadRow>> {
  const parsed = CreateLeadSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { tagIds, ...leadData } = parsed.data;

    const insertData: Record<string, unknown> = {
      organization_id: ctx.organizationId,
      created_by: ctx.userId,
      name: leadData.name,
      status: leadData.status,
      score: leadData.score,
      value: leadData.value,
      is_active: leadData.is_active ?? true,
    };

    // Only set optional fields if they have values
    if (leadData.email) insertData.email = leadData.email;
    if (leadData.phone) insertData.phone = leadData.phone;
    if (leadData.company) insertData.company = leadData.company;
    if (leadData.position) insertData.position = leadData.position;
    if (leadData.notes) insertData.notes = leadData.notes;
    if (leadData.medium) insertData.medium = leadData.medium;
    if (leadData.campaign) insertData.campaign = leadData.campaign;
    if (leadData.utm_source) insertData.utm_source = leadData.utm_source;
    if (leadData.utm_medium) insertData.utm_medium = leadData.utm_medium;
    if (leadData.utm_campaign) insertData.utm_campaign = leadData.utm_campaign;
    if (leadData.utm_content) insertData.utm_content = leadData.utm_content;
    if (leadData.utm_term) insertData.utm_term = leadData.utm_term;
    if (leadData.origin_id) insertData.origin_id = leadData.origin_id;
    if (leadData.assigned_to) insertData.assigned_to = leadData.assigned_to;

    const { data, error } = await supabase
      .from('leads')
      .insert(insertData)
      .select(LEADS_BASE_COLUMNS)
      .single();

    if (error) {
      console.error('[leads:create]', error);
      return { success: false, error: 'Não foi possível criar o lead.' };
    }

    const newLead = data as Record<string, unknown>;
    const newLeadId = newLead.id as string;

    // Sync tags
    if (tagIds && tagIds.length > 0) {
      const tagInserts = tagIds.map((tagId) => ({
        lead_id: newLeadId,
        tag_id: tagId,
      }));
      const { error: tagError } = await supabase
        .from('lead_tags')
        .insert(tagInserts);
      if (tagError) {
        console.error('[leads:create:tags]', tagError);
      }
    }

    revalidatePath('/leads');

    const enriched = enrichLeads(
      [newLead],
      new Map([[newLeadId, []]]),
      new Map(),
      new Map()
    );
    return { success: true, data: enriched[0] };
  } catch (error) {
    console.error('[leads:create] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function updateLeadAction(
  id: string,
  input: UpdateLeadInput
): Promise<ActionResponse<LeadRow>> {
  const idParsed = z.string().uuid('ID inválido').safeParse(id);
  if (!idParsed.success) {
    return { success: false, error: 'Lead não encontrado.' };
  }

  const parsed = UpdateLeadSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { tagIds, ...leadData } = parsed.data;

    const updateData: Record<string, unknown> = {
      name: leadData.name,
      email: leadData.email ?? null,
      phone: leadData.phone ?? null,
      company: leadData.company ?? null,
      position: leadData.position ?? null,
      notes: leadData.notes ?? null,
      status: leadData.status,
      score: leadData.score,
      value: leadData.value,
      medium: leadData.medium ?? null,
      campaign: leadData.campaign ?? null,
      utm_source: leadData.utm_source ?? null,
      utm_medium: leadData.utm_medium ?? null,
      utm_campaign: leadData.utm_campaign ?? null,
      utm_content: leadData.utm_content ?? null,
      utm_term: leadData.utm_term ?? null,
      origin_id: leadData.origin_id ?? null,
      assigned_to: leadData.assigned_to ?? null,
      is_active: leadData.is_active ?? true,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('leads')
      .update(updateData)
      .eq('id', idParsed.data)
      .eq('organization_id', ctx.organizationId)
      .select(LEADS_BASE_COLUMNS)
      .single();

    if (error) {
      console.error('[leads:update]', error);
      return { success: false, error: 'Não foi possível atualizar o lead.' };
    }

    // Sync tags if provided
    if (tagIds !== undefined) {
      await syncLeadTagsInternal(supabase, idParsed.data, tagIds);
    }

    revalidatePath('/leads');
    revalidatePath(`/leads/${idParsed.data}`);

    const lead = data as Record<string, unknown>;
    const enriched = enrichLeads([lead], new Map(), new Map(), new Map());
    return { success: true, data: enriched[0] };
  } catch (error) {
    console.error('[leads:update] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function deleteLeadAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Lead não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();

    // Delete lead_tags first (safe regardless of FK ON DELETE behavior)
    const { error: tagDeleteError } = await supabase
      .from('lead_tags')
      .delete()
      .eq('lead_id', parsed.data);

    if (tagDeleteError) {
      console.error('[leads:delete:tags]', tagDeleteError);
      return { success: false, error: 'Não foi possível limpar as tags do lead.' };
    }

    const { data, error } = await supabase
      .from('leads')
      .delete()
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[leads:delete]', error);
      return { success: false, error: 'Não foi possível excluir o lead.' };
    }
    if (!data) {
      return { success: false, error: 'Lead não encontrado.' };
    }

    revalidatePath('/leads');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[leads:delete] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

/* ------------------------------------------------------------------ */
/*  Soft Delete (Deactivate / Restore)                                 */
/* ------------------------------------------------------------------ */

export async function deactivateLeadAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Lead não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('leads')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[leads:deactivate]', error);
      return { success: false, error: 'Não foi possível inativar o lead.' };
    }
    if (!data) {
      return { success: false, error: 'Lead não encontrado.' };
    }

    revalidatePath('/leads');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[leads:deactivate] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function restoreLeadAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Lead não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('leads')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[leads:restore]', error);
      return { success: false, error: 'Não foi possível reativar o lead.' };
    }
    if (!data) {
      return { success: false, error: 'Lead não encontrado.' };
    }

    revalidatePath('/leads');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[leads:restore] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

/* ------------------------------------------------------------------ */
/*  Status & Assignment Actions                                        */
/* ------------------------------------------------------------------ */

export async function markLeadAsLostAction(
  id: string,
  input: MarkAsLostInput
): Promise<ActionResponse<{ ok: true }>> {
  const idParsed = z.string().uuid('ID inválido').safeParse(id);
  if (!idParsed.success) {
    return { success: false, error: 'Lead não encontrado.' };
  }

  const parsed = MarkAsLostSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    // Validate that loss_reason belongs to same org
    const { data: reason, error: reasonError } = await supabase
      .from('loss_reasons')
      .select('id')
      .eq('id', parsed.data.lossReasonId)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();

    if (reasonError || !reason) {
      return { success: false, error: 'Motivo de perda não encontrado.' };
    }

    const { data, error } = await supabase
      .from('leads')
      .update({
        status: 'lost',
        loss_reason_id: parsed.data.lossReasonId,
        loss_notes: parsed.data.lossNotes ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', idParsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[leads:markAsLost]', error);
      return { success: false, error: 'Não foi possível marcar o lead como perdido.' };
    }
    if (!data) {
      return { success: false, error: 'Lead não encontrado.' };
    }

    revalidatePath('/leads');
    revalidatePath(`/leads/${idParsed.data}`);
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[leads:markAsLost] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function updateLeadStatusAction(
  id: string,
  input: { status: LeadStatus }
): Promise<ActionResponse<{ ok: true }>> {
  const idParsed = z.string().uuid('ID inválido').safeParse(id);
  if (!idParsed.success) {
    return { success: false, error: 'Lead não encontrado.' };
  }

  const parsed = UpdateStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  if (parsed.data.status === 'lost') {
    return { success: false, error: 'Use a ação "Marcar como perdido" para definir status como perdido.' };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    // Clear loss fields when moving away from 'lost'
    const updateData: Record<string, unknown> = {
      status: parsed.data.status,
      loss_reason_id: null,
      loss_notes: null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('leads')
      .update(updateData)
      .eq('id', idParsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[leads:updateStatus]', error);
      return { success: false, error: 'Não foi possível atualizar o status.' };
    }
    if (!data) {
      return { success: false, error: 'Lead não encontrado.' };
    }

    revalidatePath('/leads');
    revalidatePath(`/leads/${idParsed.data}`);
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[leads:updateStatus] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function assignLeadAction(
  id: string,
  input: { assignedTo: string }
): Promise<ActionResponse<{ ok: true }>> {
  const idParsed = z.string().uuid('ID inválido').safeParse(id);
  if (!idParsed.success) {
    return { success: false, error: 'Lead não encontrado.' };
  }

  const parsed = AssignLeadSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    // Validate profile belongs to same org and is active
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', parsed.data.assignedTo)
      .eq('organization_id', ctx.organizationId)
      .eq('is_active', true)
      .maybeSingle();

    if (profileError || !profile) {
      return { success: false, error: 'Responsável não encontrado ou inativo.' };
    }

    const { data, error } = await supabase
      .from('leads')
      .update({
        assigned_to: parsed.data.assignedTo,
        updated_at: new Date().toISOString(),
      })
      .eq('id', idParsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[leads:assign]', error);
      return { success: false, error: 'Não foi possível atribuir o lead.' };
    }
    if (!data) {
      return { success: false, error: 'Lead não encontrado.' };
    }

    revalidatePath('/leads');
    revalidatePath(`/leads/${idParsed.data}`);
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[leads:assign] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

/* ------------------------------------------------------------------ */
/*  Tags Sync                                                          */
/* ------------------------------------------------------------------ */

async function syncLeadTagsInternal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leadId: string,
  tagIds: string[]
): Promise<void> {
  // Delete all existing tags for this lead
  await supabase.from('lead_tags').delete().eq('lead_id', leadId);

  // Insert new tags
  if (tagIds.length > 0) {
    const inserts = tagIds.map((tagId) => ({
      lead_id: leadId,
      tag_id: tagId,
    }));
    const { error } = await supabase.from('lead_tags').insert(inserts);
    if (error) {
      console.error('[leads:syncTags]', error);
    }
  }
}

export async function syncLeadTagsAction(
  leadId: string,
  tagIds: string[]
): Promise<ActionResponse<{ ok: true }>> {
  const idParsed = z.string().uuid('ID inválido').safeParse(leadId);
  if (!idParsed.success) {
    return { success: false, error: 'Lead não encontrado.' };
  }

  const tagsParsed = z.array(z.string().uuid()).safeParse(tagIds);
  if (!tagsParsed.success) {
    return { success: false, error: 'Tags inválidas.' };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    // Verify lead belongs to org
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('id', idParsed.data)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();

    if (!lead) {
      return { success: false, error: 'Lead não encontrado.' };
    }

    await syncLeadTagsInternal(supabase, idParsed.data, tagsParsed.data);

    revalidatePath('/leads');
    revalidatePath(`/leads/${idParsed.data}`);
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[leads:syncTags] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

/* ------------------------------------------------------------------ */
/*  Lookup Actions (for selects/filters in UI)                         */
/* ------------------------------------------------------------------ */

export async function getActiveOriginsAction(): Promise<ActionResponse<OriginOption[]>> {
  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('lead_origins')
      .select('id, name')
      .eq('organization_id', ctx.organizationId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      console.error('[leads:origins]', error);
      return { success: false, error: 'Não foi possível carregar as origens.' };
    }

    return {
      success: true,
      data: (data ?? []).map((r) => ({ id: r.id as string, name: r.name as string })),
    };
  } catch (error) {
    console.error('[leads:origins] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function getActiveLossReasonsAction(): Promise<ActionResponse<LossReasonOption[]>> {
  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('loss_reasons')
      .select('id, name')
      .eq('organization_id', ctx.organizationId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      console.error('[leads:lossReasons]', error);
      return { success: false, error: 'Não foi possível carregar os motivos de perda.' };
    }

    return {
      success: true,
      data: (data ?? []).map((r) => ({ id: r.id as string, name: r.name as string })),
    };
  } catch (error) {
    console.error('[leads:lossReasons] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function getActiveProfilesAction(): Promise<ActionResponse<ProfileOption[]>> {
  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('organization_id', ctx.organizationId)
      .eq('is_active', true)
      .order('full_name', { ascending: true });

    if (error) {
      console.error('[leads:profiles]', error);
      return { success: false, error: 'Não foi possível carregar os membros da equipe.' };
    }

    return {
      success: true,
      data: (data ?? []).map((r) => ({ id: r.id as string, full_name: r.full_name as string })),
    };
  } catch (error) {
    console.error('[leads:profiles] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function getActiveTagsForLeadsAction(): Promise<ActionResponse<TagOption[]>> {
  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('tags')
      .select('id, name, color')
      .eq('organization_id', ctx.organizationId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      console.error('[leads:tags]', error);
      return { success: false, error: 'Não foi possível carregar as tags.' };
    }

    return {
      success: true,
      data: (data ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        color: r.color as string,
      })),
    };
  } catch (error) {
    console.error('[leads:tags] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
