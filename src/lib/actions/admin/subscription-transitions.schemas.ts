import { z } from 'zod';

export const TriggerLazyTransitionSchema = z.object({
  organizationId: z.string().uuid('ID de organização inválido'),
});

export type TriggerLazyTransitionInput = z.input<typeof TriggerLazyTransitionSchema>;

export interface SubscriptionTransitionResult {
  transitioned: number;
  trialExpired: number;
  pastDueBlocked: number;
  canceladaBlocked: number;
  source: string;
  ranAt: string;
}
