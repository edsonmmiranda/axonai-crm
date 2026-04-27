import { z } from 'zod';

const keySchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'Key deve ser snake_case iniciando com letra minúscula.');

export const GetPlatformSettingsSchema = z.object({});

export const UpdatePlatformSettingSchema = z.discriminatedUnion('valueType', [
  z.object({ key: keySchema, valueType: z.literal('text'), value: z.string() }),
  z.object({ key: keySchema, valueType: z.literal('int'),  value: z.number().int() }),
  z.object({ key: keySchema, valueType: z.literal('bool'), value: z.boolean() }),
  z.object({ key: keySchema, valueType: z.literal('jsonb'), value: z.unknown() }),
]);

export type UpdatePlatformSettingInput = z.input<typeof UpdatePlatformSettingSchema>;

export interface PlatformSettingValue {
  type: 'text';  value: string;
}
export type SettingValue =
  | { type: 'text';  value: string }
  | { type: 'int';   value: number }
  | { type: 'bool';  value: boolean }
  | { type: 'jsonb'; value: unknown };

export interface PlatformSetting {
  key: string;
  description: string;
  value: SettingValue;
  updatedAt: string;
  updatedBy: { id: string; name: string | null } | null;
}
