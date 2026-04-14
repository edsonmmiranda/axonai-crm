import { z } from 'zod';

export const ItemInputSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(120),
  description: z.string().trim().max(2000).optional(),
});

export const ItemSchema = ItemInputSchema.extend({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const ItemIdSchema = z.object({ id: z.string().uuid() });

export const ListItemsParamsSchema = z.object({
  page: z.number().int().min(1).default(1),
  itemsPerPage: z.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional(),
  sort: z.enum(['name', 'created_at']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type ItemInput = z.infer<typeof ItemInputSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type ListItemsParams = z.infer<typeof ListItemsParamsSchema>;
