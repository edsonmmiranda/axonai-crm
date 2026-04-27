import { z } from 'zod';

const credentialKindSchema = z.literal('email_smtp');

const smtpMetadataSchema = z.object({
  host:      z.string().trim().min(1).max(255),
  port:      z.number().int().min(1).max(65535),
  user:      z.string().trim().min(1).max(255),
  secure:    z.boolean(),
  fromEmail: z.string().trim().email().max(320),
});

export type SmtpMetadata = z.infer<typeof smtpMetadataSchema>;

export const CreateIntegrationCredentialSchema = z.object({
  kind:            credentialKindSchema,
  label:           z.string().trim().min(1).max(80),
  metadata:        smtpMetadataSchema,
  secretPlaintext: z.string().min(1).max(500),
});

export const RotateIntegrationCredentialSchema = z.object({
  id:                 z.string().uuid(),
  newSecretPlaintext: z.string().min(1).max(500),
  newMetadata:        smtpMetadataSchema,
});

export const RevokeIntegrationCredentialSchema = z.object({
  id:          z.string().uuid(),
  confirmKind: credentialKindSchema,
});

export type CreateIntegrationCredentialInput = z.input<typeof CreateIntegrationCredentialSchema>;
export type RotateIntegrationCredentialInput = z.input<typeof RotateIntegrationCredentialSchema>;
export type RevokeIntegrationCredentialInput = z.input<typeof RevokeIntegrationCredentialSchema>;

/**
 * Projeção de credencial expostas pela API admin.
 * NÃO contém secretPlaintext nem vault_secret_id — Guardian valida via grep.
 */
export interface IntegrationCredentialView {
  id:           string;
  kind:         'email_smtp';
  label:        string;
  metadata:     SmtpMetadata;
  hint:         string | null;
  createdAt:    string;
  createdBy:    string | null;
  lastUsedAt:   string | null;
  rotatedAt:    string | null;
  revokedAt:    string | null;
}
