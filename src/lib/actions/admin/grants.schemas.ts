import { z } from 'zod';

export const LimitKeySchema = z.enum([
  'users',
  'leads',
  'products',
  'pipelines',
  'active_integrations',
  'storage_mb',
]);
export type LimitKey = z.infer<typeof LimitKeySchema>;

export const ListGrantsFiltersSchema = z.object({
  organizationId:  z.string().uuid('Organização inválida'),
  includeRevoked:  z.boolean().default(false),
  includeExpired:  z.boolean().default(false),
});

export const CreateGrantSchema = z.object({
  organizationId: z.string().uuid('Organização inválida'),
  limitKey:       LimitKeySchema,
  valueOverride:  z
    .number()
    .int('Valor deve ser inteiro')
    .nonnegative('Valor não pode ser negativo')
    .nullable(),
  reason: z
    .string()
    .trim()
    .min(5, 'Razão precisa ter no mínimo 5 caracteres')
    .max(500, 'Razão excede 500 caracteres'),
  expiresAt: z
    .union([z.string(), z.date(), z.null()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === null || value === '') return null;
      if (value instanceof Date) return value;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    })
    .refine((d) => d === null || d > new Date(), {
      message: 'Expiração deve ser futura',
    }),
});

export const RevokeGrantSchema = z.object({
  grantId:              z.string().uuid('Grant inválido'),
  limitKeyConfirmation: LimitKeySchema,
});

export type ListGrantsFiltersInput = z.input<typeof ListGrantsFiltersSchema>;
export type CreateGrantInput       = z.input<typeof CreateGrantSchema>;
export type RevokeGrantInput       = z.input<typeof RevokeGrantSchema>;
