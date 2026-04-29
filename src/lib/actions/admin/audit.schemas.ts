import { z } from 'zod';

/* ─────────────────────────────────────────────────────────────────────────
 * Sprint admin_12 — Schemas Zod para Server Actions de leitura do audit_log.
 * ────────────────────────────────────────────────────────────────────── */

/* Filtros */

const ActionSlugRegex = /^[a-z_]+\.[a-z_]+$/;
const TargetTypeRegex = /^[a-z_]+$/;

export const AuditPeriodSchema = z.discriminatedUnion('preset', [
  z.object({ preset: z.literal('24h') }),
  z.object({ preset: z.literal('7d') }),
  z.object({ preset: z.literal('30d') }),
  z.object({
    preset: z.literal('custom'),
    from:   z.string().datetime({ message: 'from inválido (ISO 8601 esperado)' }),
    to:     z.string().datetime({ message: 'to inválido (ISO 8601 esperado)' }),
  }).refine((d) => new Date(d.from).getTime() < new Date(d.to).getTime(), {
    message: 'from deve ser anterior a to',
    path:    ['from'],
  }),
]);

export const AuditFiltersSchema = z.object({
  actions:        z.array(z.string().regex(ActionSlugRegex, 'slug inválido')).max(20).optional(),
  actorProfileId: z.string().uuid().optional(),
  targetOrgId:    z.string().uuid().optional(),
  targetType:     z.string().regex(TargetTypeRegex).max(50).optional(),
  period:         AuditPeriodSchema.optional(),
});

export const AuditCursorSchema = z.object({
  occurredAt: z.string().datetime(),
  id:         z.string().uuid(),
});

export const ListAuditInputSchema = z.object({
  filters: AuditFiltersSchema.default({}),
  cursor:  AuditCursorSchema.optional(),
});

export const GetAuditEntrySchema = z.object({
  id: z.string().uuid('id inválido'),
});

export const SearchAuditActorsSchema = z.object({
  query: z.string().min(2, 'mínimo 2 caracteres').max(100),
});

/* Tipos */

export type AuditPeriod         = z.infer<typeof AuditPeriodSchema>;
export type AuditFilters        = z.infer<typeof AuditFiltersSchema>;
export type AuditCursor         = z.infer<typeof AuditCursorSchema>;
export type ListAuditInput      = z.input<typeof ListAuditInputSchema>;
export type GetAuditEntryInput  = z.input<typeof GetAuditEntrySchema>;
export type SearchActorsInput   = z.input<typeof SearchAuditActorsSchema>;

export interface AuditLogRow {
  id:                   string;
  occurredAt:           string;
  actorProfileId:       string | null;
  actorEmailSnapshot:   string | null;
  action:               string;
  targetType:           string;
  targetId:             string | null;
  targetOrganizationId: string | null;
  diffBefore:           Record<string, unknown> | null;
  diffAfter:            Record<string, unknown> | null;
  ipAddress:            string | null;
  userAgent:            string | null;
  metadata:             Record<string, unknown> | null;
}

export interface ListAuditResult {
  rows:       AuditLogRow[];
  nextCursor: AuditCursor | null;
}

export interface AuditActorSearchRow {
  actorProfileId:     string;
  actorEmailSnapshot: string | null;
}
