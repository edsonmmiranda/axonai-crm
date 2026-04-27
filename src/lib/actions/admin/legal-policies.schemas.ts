import { z } from 'zod';

export const LEGAL_POLICY_KINDS = ['terms', 'privacy', 'dpa', 'cookies'] as const;
export type LegalPolicyKind = (typeof LEGAL_POLICY_KINDS)[number];

export const GetLegalPolicyVersionsSchema = z.object({
  kind: z.enum(LEGAL_POLICY_KINDS),
});

export const CreateLegalPolicySchema = z.object({
  kind:        z.enum(LEGAL_POLICY_KINDS),
  effectiveAt: z.coerce.date(),
  contentMd:   z.string().min(50, 'Conteúdo muito curto (mín. 50 chars).').max(200_000, 'Conteúdo muito longo (máx. 200.000 chars).'),
  summary:     z.string().min(10, 'Resumo muito curto (mín. 10 chars).').max(500, 'Resumo muito longo (máx. 500 chars).'),
});

export type GetLegalPolicyVersionsInput = z.input<typeof GetLegalPolicyVersionsSchema>;
export type CreateLegalPolicyInput = z.input<typeof CreateLegalPolicySchema>;

export interface LegalPolicyVersion {
  id: string;
  kind: LegalPolicyKind;
  version: number;
  effectiveAt: string;
  summary: string;
  contentMd: string;
  createdAt: string;
  createdBy: { id: string; name: string | null };
}

export interface ActiveLegalPolicyEntry {
  kind: LegalPolicyKind;
  activeVersion: Omit<LegalPolicyVersion, 'contentMd'> | null;
}
