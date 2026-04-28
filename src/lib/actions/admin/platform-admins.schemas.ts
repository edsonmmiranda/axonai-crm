import { z } from 'zod';

export const PlatformAdminRoleSchema = z.enum(['owner', 'support', 'billing']);
export type PlatformAdminRoleInput = z.infer<typeof PlatformAdminRoleSchema>;

export const CreateInvitationSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Email inválido')
    .max(320, 'Email muito longo'),
  role: PlatformAdminRoleSchema,
});

export const RevokeInvitationSchema = z.object({
  id: z.string().uuid('ID inválido'),
});

export const ConsumeInvitationSchema = z.object({
  token: z.string().uuid('Token inválido'),
  password: z
    .string()
    .min(8, 'Senha deve ter ao menos 8 caracteres')
    .max(128, 'Senha muito longa'),
});

export const ChangeRoleSchema = z.object({
  id: z.string().uuid('ID inválido'),
  newRole: PlatformAdminRoleSchema,
});

export const DeactivateAdminSchema = z.object({
  id: z.string().uuid('ID inválido'),
  confirmEmail: z.string().trim().email('Email de confirmação inválido'),
});

export const RequestMfaResetSchema = z.object({
  targetAdminId: z.string().uuid('ID inválido'),
  reason: z
    .string()
    .trim()
    .min(5, 'Motivo deve ter ao menos 5 caracteres')
    .max(500, 'Motivo deve ter no máximo 500 caracteres'),
});

export const ApproveMfaResetSchema = z.object({
  requestId: z.string().uuid('ID inválido'),
});

export const RevokeMfaResetSchema = z.object({
  requestId: z.string().uuid('ID inválido'),
});

export const ListInvitationsFilterSchema = z
  .enum(['pending', 'consumed', 'revoked', 'expired', 'all'])
  .default('pending');

export const ListMfaResetFilterSchema = z
  .enum(['pending', 'approved', 'consumed', 'revoked', 'expired', 'all'])
  .default('pending');

export type CreateInvitationInput = z.input<typeof CreateInvitationSchema>;
export type RevokeInvitationInput = z.input<typeof RevokeInvitationSchema>;
export type ConsumeInvitationInput = z.input<typeof ConsumeInvitationSchema>;
export type ChangeRoleInput = z.input<typeof ChangeRoleSchema>;
export type DeactivateAdminInput = z.input<typeof DeactivateAdminSchema>;
export type RequestMfaResetInput = z.input<typeof RequestMfaResetSchema>;
export type ApproveMfaResetInput = z.input<typeof ApproveMfaResetSchema>;
export type RevokeMfaResetInput = z.input<typeof RevokeMfaResetSchema>;
export type ListInvitationsFilter = z.input<typeof ListInvitationsFilterSchema>;
export type ListMfaResetFilter = z.input<typeof ListMfaResetFilterSchema>;

export interface PlatformAdminListRow {
  id: string;
  profileId: string;
  role: 'owner' | 'support' | 'billing';
  isActive: boolean;
  createdAt: string;
  deactivatedAt: string | null;
  createdBy: string | null;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  lastSignInAt: string | null;
  mfaConfigured: boolean;
  mfaResetRequired: boolean;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: 'owner' | 'support' | 'billing';
  token: string;
  expiresAt: string;
  consumedAt: string | null;
  consumedByProfileId: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  emailDeliveryLogId: string | null;
  createdBy: string;
  createdAt: string;
}

export interface MfaResetRequestRow {
  id: string;
  targetPlatformAdminId: string;
  targetProfileId: string;
  requestedBy: string;
  reason: string;
  requestedAt: string;
  expiresAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  consumedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
}

export type InvitationStatus = 'valid' | 'expired' | 'consumed' | 'revoked';

export interface InvitationByToken {
  email: string;
  role: 'owner' | 'support' | 'billing';
  expiresAt: string;
  status: InvitationStatus;
}

export interface CreateInvitationResult {
  invitation: InvitationRow;
  deliveryStatus: 'sent' | 'fallback_offline' | 'error';
  offlineLink?: string;
  errorMessage?: string;
}

export interface ConsumeInvitationResult {
  profileId: string;
  redirectTo: '/admin/mfa-enroll?firstEnroll=true';
}
