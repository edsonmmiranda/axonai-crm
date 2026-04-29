import { z } from 'zod';

export const CompletePasswordResetSchema = z.object({
  newPassword: z
    .string()
    .min(8, 'Senha deve ter ao menos 8 caracteres')
    .max(128, 'Senha muito longa'),
});

export const CompleteMfaReenrollSchema = z.object({
  factorId:    z.string().min(1, 'factorId obrigatório'),
  challengeId: z.string().min(1, 'challengeId obrigatório'),
  code:        z.string().regex(/^\d{6}$/, 'Código TOTP deve ter 6 dígitos'),
});

export const SignInAdminSchema = z.object({
  email:    z.string().email('E-mail inválido').max(320),
  password: z.string().min(1, 'Senha obrigatória').max(128),
});

export type CompletePasswordResetInput = z.input<typeof CompletePasswordResetSchema>;
export type CompleteMfaReenrollInput   = z.input<typeof CompleteMfaReenrollSchema>;
export type SignInAdminInput           = z.input<typeof SignInAdminSchema>;

export interface CompletePasswordResetResult {
  redirectTo: '/admin/login';
}

export interface CompleteMfaReenrollResult {
  redirectTo: '/admin/dashboard';
}

export interface SignInAdminResult {
  redirectTo: '/admin/mfa-challenge' | '/admin/mfa-enroll';
}
