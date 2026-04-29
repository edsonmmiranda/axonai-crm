/**
 * Sprint admin_12 — Registry canônico de action slugs do audit_log.
 *
 * Lista exaustiva dos slugs emitidos por todos os sprints admin (01..12).
 * Adicionado em qualquer sprint futuro: incluir aqui na mesma PR para que
 * o frontend renderize agrupamento + cor + label corretos.
 *
 * Slugs não-listados aparecem na UI como "neutral" + tooltip
 * "Slug não registrado em actionRegistry.ts".
 */

export const AUDIT_ACTION_REGISTRY = {
  'org.*':                    ['org.create', 'org.suspend', 'org.reactivate'],
  'subscription.*':           ['subscription.change_plan', 'subscription.extend_trial', 'subscription.cancel', 'subscription.reactivate', 'subscription.auto_expire'],
  'plan.*':                   ['plan.create', 'plan.update', 'plan.archive', 'plan.delete'],
  'grant.*':                  ['grant.create', 'grant.revoke'],
  'inspect.*':                ['inspect.read_leads', 'inspect.read_users', 'inspect.read_products', 'inspect.read_funnels', 'inspect.read_categories', 'inspect.read_tags', 'inspect.read_lead_origins', 'inspect.read_loss_reasons', 'inspect.read_whatsapp_groups'],
  'platform_admin.*':         ['platform_admin.invite_create', 'platform_admin.invite_revoke', 'platform_admin.invite_consume', 'platform_admin.role_change', 'platform_admin.deactivate', 'platform_admin.mfa_reset_request', 'platform_admin.mfa_reset_approve', 'platform_admin.mfa_reset_revoke', 'platform_admin.mfa_reset_consume'],
  'password_reset.*':         ['password_reset.complete_admin', 'password_reset.mfa_reenroll_complete'],
  'auth.*':                   ['auth.login_admin_success', 'auth.login_rate_limited'],
  'settings.*':               ['settings.update'],
  'feature_flag.*':           ['feature_flag.set'],
  'legal_policy.*':           ['legal_policy.create'],
  'integration_credential.*': ['integration_credential.create', 'integration_credential.rotate', 'integration_credential.revoke'],
  'email.*':                  ['email.offline_fallback'],
  'metrics.*':                ['metrics.refresh'],
  'break_glass.*':            ['break_glass.recover_owner'],
} as const;

/**
 * Prefixos visíveis para `role='billing'` (decisão (f) do PRD admin_12 §0).
 * Validado contra docs/admin_area/rbac_matrix.md linha 82.
 */
export const AUDIT_BILLING_PREFIXES = ['org', 'plan', 'subscription', 'grant'] as const;
export type AuditBillingPrefix = (typeof AUDIT_BILLING_PREFIXES)[number];

export type AuditPaletteVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/**
 * Mapping de slug → variant de Badge (token semântico).
 * Slugs não-mapeados → 'neutral' + tooltip "Slug não registrado".
 */
export const AUDIT_ACTION_PALETTE: Record<string, AuditPaletteVariant> = {
  // create → success
  'org.create':                       'success',
  'plan.create':                      'success',
  'grant.create':                     'success',
  'integration_credential.create':    'success',
  'platform_admin.invite_create':     'success',
  'legal_policy.create':              'success',

  // mutating updates → warning
  'subscription.change_plan':         'warning',
  'subscription.extend_trial':        'warning',
  'plan.update':                      'warning',
  'platform_admin.role_change':       'warning',
  'settings.update':                  'warning',
  'feature_flag.set':                 'warning',
  'integration_credential.rotate':    'warning',

  // destructive / security-critical → danger
  'org.suspend':                      'danger',
  'subscription.cancel':              'danger',
  'plan.archive':                     'danger',
  'plan.delete':                      'danger',
  'grant.revoke':                     'danger',
  'platform_admin.deactivate':        'danger',
  'platform_admin.invite_revoke':     'danger',
  'integration_credential.revoke':    'danger',
  'auth.login_rate_limited':          'danger',
  'break_glass.recover_owner':        'danger',

  // reactivate → info
  'org.reactivate':                   'info',
  'subscription.reactivate':          'info',

  // routine / read / completion → neutral
  'auth.login_admin_success':         'neutral',
  'metrics.refresh':                  'neutral',
  'email.offline_fallback':           'neutral',
  'password_reset.complete_admin':    'neutral',
  'password_reset.mfa_reenroll_complete': 'neutral',
  'platform_admin.mfa_reset_request': 'neutral',
  'platform_admin.mfa_reset_approve': 'neutral',
  'platform_admin.mfa_reset_revoke':  'neutral',
  'platform_admin.mfa_reset_consume': 'neutral',
  'platform_admin.invite_consume':    'neutral',
  'subscription.auto_expire':         'neutral',
  'inspect.read_leads':               'neutral',
  'inspect.read_users':               'neutral',
  'inspect.read_products':            'neutral',
  'inspect.read_funnels':             'neutral',
  'inspect.read_categories':          'neutral',
  'inspect.read_tags':                'neutral',
  'inspect.read_lead_origins':        'neutral',
  'inspect.read_loss_reasons':        'neutral',
  'inspect.read_whatsapp_groups':     'neutral',
};

export function paletteFor(action: string): AuditPaletteVariant {
  return AUDIT_ACTION_PALETTE[action] ?? 'neutral';
}

/** Retorna todos os slugs conhecidos (flat array). */
export function allKnownActions(): readonly string[] {
  return Object.values(AUDIT_ACTION_REGISTRY).flat();
}

/** Retorna o prefixo de um slug (parte antes do primeiro `.`). */
export function prefixOf(action: string): string {
  const idx = action.indexOf('.');
  return idx < 0 ? action : action.slice(0, idx);
}
