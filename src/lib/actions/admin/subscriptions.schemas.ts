import { z } from 'zod';

export const ChangePlanSchema = z.object({
  subscriptionId: z.string().uuid('ID de subscription inválido'),
  newPlanId:      z.string().uuid('Selecione um plano'),
  effectiveAt:    z.string().datetime({ message: 'Data inválida' }).optional(),
});

export const ExtendTrialSchema = z.object({
  subscriptionId: z.string().uuid('ID de subscription inválido'),
  days:           z.number().int().min(1, 'Mínimo 1 dia').max(365, 'Máximo 365 dias'),
});

export const CancelSubscriptionSchema = z.object({
  subscriptionId: z.string().uuid('ID de subscription inválido'),
  effectiveAt:    z.string().datetime({ message: 'Data inválida' }).optional(),
});

export const ReactivateSubscriptionSchema = z.object({
  subscriptionId: z.string().uuid('ID de subscription inválido'),
  newPlanId:      z.string().uuid('Selecione um plano'),
});

export const MarkPastDueSchema = z.object({
  subscriptionId: z.string().uuid('ID de subscription inválido'),
});

export type ChangePlanInput          = z.input<typeof ChangePlanSchema>;
export type ExtendTrialInput         = z.input<typeof ExtendTrialSchema>;
export type CancelSubscriptionInput  = z.input<typeof CancelSubscriptionSchema>;
export type ReactivateSubscriptionInput = z.input<typeof ReactivateSubscriptionSchema>;
export type MarkPastDueInput         = z.input<typeof MarkPastDueSchema>;
