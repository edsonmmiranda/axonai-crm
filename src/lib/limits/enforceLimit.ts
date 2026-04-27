import 'server-only';

import { createClient } from '@/lib/supabase/server';

import { mapEnforceLimitError, type LimitKey } from './enforceLimitError';

export type { LimitKey } from './enforceLimitError';

export type EnforceLimitResult = { ok: true } | { ok: false; error: string };

export interface EnforceLimitInput {
  organizationId: string;
  limitKey: LimitKey;
  delta: number;
}

/**
 * Chama a RPC `enforce_limit` antes de qualquer criação de recurso contável
 * em Server Actions customer (leads, products, funnels, invitations,
 * whatsapp-groups, product-images, product-documents).
 *
 * Retorna `{ ok: true }` quando a criação cabe; `{ ok: false, error }` com
 * mensagem em pt-BR quando o limite efetivo (plano vigente, opcionalmente
 * substituído pelo grant ativo mais recente) seria estourado.
 *
 * Nunca lança — falhas inesperadas viram mensagem genérica + console.error.
 *
 * Race: aceita overshoot máximo de 1 sob carga concorrente (decisão fixada
 * no Sprint 07, Sprint 13 evolui para hard-cap se necessário).
 */
export async function enforceLimit(input: EnforceLimitInput): Promise<EnforceLimitResult> {
  const supabase = await createClient();

  const { error } = await supabase.rpc('enforce_limit', {
    p_org_id: input.organizationId,
    p_limit_key: input.limitKey,
    p_delta: input.delta,
  });

  if (!error) return { ok: true };
  return { ok: false, error: mapEnforceLimitError(error, input.limitKey) };
}
