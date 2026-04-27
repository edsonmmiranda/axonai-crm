export interface FeatureFlagSpec {
  key: string;
  label: string;
  description: string;
  /** Visível ao customer app via getPublicFlags(). */
  isPublic: boolean;
  defaultEnabled: boolean;
}

export const FEATURE_FLAG_REGISTRY = [
  {
    key: 'enable_public_signup',
    label: 'Signup público',
    description: 'Habilita a rota /signup pública no customer app (D-1).',
    isPublic: false,
    defaultEnabled: false,
  },
  {
    key: 'enable_ai_summarization',
    label: 'Sumarização por IA',
    description: 'Habilita sumarização automática de leads por IA.',
    isPublic: true,
    defaultEnabled: false,
  },
] as const satisfies FeatureFlagSpec[];

export type RegisteredFlagKey = (typeof FEATURE_FLAG_REGISTRY)[number]['key'];

export function isRegisteredFlagKey(key: string): key is RegisteredFlagKey {
  return FEATURE_FLAG_REGISTRY.some((r) => r.key === key);
}
