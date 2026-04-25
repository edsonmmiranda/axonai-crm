import { z } from 'zod';

/* ------------------------------------------------------------------ */
/*  Limites do plano (reutilizados em Create e Update)                 */
/* ------------------------------------------------------------------ */

const planLimitsSchema = z.object({
  maxUsers:              z.number().int().min(1).nullable().optional(),
  maxLeads:              z.number().int().min(1).nullable().optional(),
  maxProducts:           z.number().int().min(1).nullable().optional(),
  maxPipelines:          z.number().int().min(1).nullable().optional(),
  maxActiveIntegrations: z.number().int().min(1).nullable().optional(),
  maxStorageMb:          z.number().int().min(1).nullable().optional(),
  allowAiFeatures:       z.boolean().default(false),
});

/* ------------------------------------------------------------------ */
/*  Schemas                                                             */
/* ------------------------------------------------------------------ */

export const ListPlansSchema = z.object({
  search:     z.string().trim().max(100).optional(),
  isPublic:   z.boolean().optional(),
  isArchived: z.boolean().optional().default(false),
  page:       z.number().int().min(1).default(1),
  pageSize:   z.number().int().min(1).max(100).default(25),
  sortBy:     z.enum(['name', 'created_at', 'price_monthly_cents']).default('created_at'),
  sortOrder:  z.enum(['asc', 'desc']).default('desc'),
});

export const CreatePlanSchema = z
  .object({
    name:         z.string().trim().min(2, 'Nome deve ter ao menos 2 caracteres').max(100, 'Nome deve ter no máximo 100 caracteres'),
    description:  z.string().trim().max(500).optional().or(z.literal('').transform(() => undefined)),
    priceMonthly: z.number().int().min(0, 'Preço deve ser >= 0'),
    priceYearly:  z.number().int().min(0, 'Preço deve ser >= 0'),
    featuresJsonb: z.array(z.string().trim().min(1)).default([]),
    isPublic:     z.boolean().default(true),
  })
  .merge(planLimitsSchema);

export const UpdatePlanSchema = z
  .object({ id: z.string().uuid() })
  .merge(CreatePlanSchema);

export const ArchivePlanSchema = z.object({ id: z.string().uuid() });
export const DeletePlanSchema  = z.object({ id: z.string().uuid() });

/* ------------------------------------------------------------------ */
/*  Exported input types                                               */
/* ------------------------------------------------------------------ */

export type ListPlansInput   = z.input<typeof ListPlansSchema>;
export type CreatePlanInput  = z.input<typeof CreatePlanSchema>;
export type UpdatePlanInput  = z.input<typeof UpdatePlanSchema>;
export type ArchivePlanInput = z.input<typeof ArchivePlanSchema>;
export type DeletePlanInput  = z.input<typeof DeletePlanSchema>;
