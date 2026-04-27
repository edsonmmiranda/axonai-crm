import 'server-only';

export type LimitKey =
  | 'users'
  | 'leads'
  | 'products'
  | 'pipelines'
  | 'active_integrations'
  | 'storage_mb';

export interface EnforceLimitDetail {
  limit_key: LimitKey;
  limit: number;
  current: number;
  delta: number;
}

const RESOURCE_LABEL: Record<LimitKey, string> = {
  users: 'usuários',
  leads: 'leads',
  products: 'produtos',
  pipelines: 'pipelines',
  active_integrations: 'integrações ativas',
  storage_mb: 'MB de armazenamento',
};

const ACTION_PHRASE: Record<LimitKey, string> = {
  users: 'Para convidar mais',
  leads: 'Para criar mais',
  products: 'Para criar mais',
  pipelines: 'Para criar mais',
  active_integrations: 'Para ativar mais',
  storage_mb: 'Para enviar mais arquivos',
};

const numberFormatter = new Intl.NumberFormat('pt-BR');

interface PostgrestLikeError {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

function tryParseDetail(details: string | null | undefined): EnforceLimitDetail | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.limit_key === 'string' &&
      typeof parsed.limit === 'number' &&
      typeof parsed.current === 'number' &&
      typeof parsed.delta === 'number'
    ) {
      return parsed as EnforceLimitDetail;
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

export function mapEnforceLimitError(error: PostgrestLikeError, limitKey: LimitKey): string {
  const message = error.message ?? '';

  if (message.includes('plan_limit_exceeded')) {
    const detail = tryParseDetail(error.details);
    const limit = detail?.limit ?? 0;
    const resource = RESOURCE_LABEL[limitKey];
    const action = ACTION_PHRASE[limitKey];
    return `Seu plano permite até ${numberFormatter.format(limit)} ${resource}. ${action}, faça upgrade ou contate o suporte.`;
  }

  if (message.includes('no_active_subscription')) {
    return 'Sua organização não tem subscription vigente. Contate o suporte.';
  }

  if (message.includes('invalid_limit_key') || message.includes('invalid_delta')) {
    return 'Erro interno ao validar limites. Contate o suporte.';
  }

  console.error('[enforce_limit]', error);
  return 'Não foi possível validar limites. Tente novamente.';
}
