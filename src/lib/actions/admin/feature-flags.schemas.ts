import { z } from 'zod';

import { FEATURE_FLAG_REGISTRY } from '@/lib/featureFlags/registry';

export const SetFeatureFlagSchema = z.object({
  key: z.string().refine(
    (k) => FEATURE_FLAG_REGISTRY.some((r) => r.key === k),
    { message: 'Feature flag não registrada no sistema.' },
  ),
  enabled: z.boolean(),
  config:  z.record(z.string(), z.unknown()).default({}),
});

export type SetFeatureFlagInput = z.input<typeof SetFeatureFlagSchema>;

export interface FeatureFlagView {
  key: string;
  label: string;
  description: string;
  isPublic: boolean;
  defaultEnabled: boolean;
  enabled: boolean;
  config: Record<string, unknown>;
  isInitialized: boolean;
  updatedAt: string | null;
  updatedBy: { id: string; name: string | null } | null;
}
