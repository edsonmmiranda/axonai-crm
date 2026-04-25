import { z } from 'zod';

// ── Slug ─────────────────────────────────────────────────────────────────────

export const slugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{2,49}$/, 'Slug inválido. Use letras minúsculas, números e hífens (3–50 chars).');

/** Converte nome em slug sugerido — determinístico. */
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50);
}

// ── Schemas ───────────────────────────────────────────────────────────────────

export const ListOrgsSchema = z.object({
  search:    z.string().trim().max(100).optional(),
  isActive:  z.boolean().optional(),
  planId:    z.string().uuid().optional(),
  subStatus: z.enum(['trial', 'ativa', 'past_due', 'trial_expired', 'cancelada', 'suspensa']).optional(),
  page:      z.number().int().min(1).default(1),
  pageSize:  z.number().int().min(1).max(100).default(25),
  sortBy:    z.enum(['name', 'created_at', 'is_active']).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const CreateOrgSchema = z.object({
  name:            z.string().trim().min(2, 'Nome muito curto').max(200, 'Nome muito longo'),
  slug:            slugSchema,
  planId:          z.string().uuid('Plano obrigatório'),
  firstAdminEmail: z.string().email('E-mail inválido'),
  trialDays:       z.number().int().min(1).max(365).default(14),
});

export const SuspendOrgSchema = z.object({
  id:               z.string().uuid(),
  slugConfirmation: z.string().min(1, 'Digite o slug para confirmar'),
  reason:           z.string().trim().min(5, 'Motivo muito curto (mín. 5 chars)').max(500, 'Motivo muito longo'),
});

export const ReactivateOrgSchema = z.object({
  id:               z.string().uuid(),
  slugConfirmation: z.string().min(1, 'Digite o slug para confirmar'),
});

// ── Exported input types ──────────────────────────────────────────────────────

export type ListOrgsInput      = z.input<typeof ListOrgsSchema>;
export type CreateOrgInput     = z.input<typeof CreateOrgSchema>;
export type SuspendOrgInput    = z.input<typeof SuspendOrgSchema>;
export type ReactivateOrgInput = z.input<typeof ReactivateOrgSchema>;
