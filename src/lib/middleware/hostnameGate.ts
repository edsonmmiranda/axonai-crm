import 'server-only';

/**
 * Hostname gate (Sprint admin_13 — RNF-SEC-1, RNF-SEC-2, T-01).
 *
 * Garante que /admin/* só seja servido em NEXT_PUBLIC_ADMIN_HOST e que o customer
 * host (NEXT_PUBLIC_CUSTOMER_HOST) recuse qualquer request a /admin/*. Em dev local
 * (host inclui localhost ou 127.0.0.1), o gate roda em modo permissivo. Em produção
 * sem env vars configuradas, faz hard-fail (defesa contra deploy mal-configurado).
 *
 * Pure function — pode ser testada sem mock de NextRequest.
 */

export type HostnameGateDecision =
  | { allowed: true; reason: 'admin_host_admin_path' | 'customer_host_non_admin' | 'dev_permissive' | 'unknown_host_non_admin' }
  | { allowed: false; reason: 'customer_host_admin_path' | 'admin_host_non_admin' | 'unknown_host_admin_path' | 'prod_misconfigured'; status: 404 | 503 };

interface GateConfig {
  adminHost: string | null;
  customerHost: string | null;
  isProduction: boolean;
}

const DEV_HOST_MARKERS = ['localhost', '127.0.0.1', '0.0.0.0'];

function normalizeHost(host: string | null): string | null {
  if (!host) return null;
  return host.trim().toLowerCase().split(':')[0] ?? null;
}

function isDevHost(host: string | null): boolean {
  if (!host) return false;
  return DEV_HOST_MARKERS.some((m) => host.includes(m));
}

function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

export function evaluateHostnameGate(
  host: string | null,
  pathname: string,
  config: GateConfig,
): HostnameGateDecision {
  const normalized = normalizeHost(host);
  const adminPath = isAdminPath(pathname);

  // Dev permissivo: qualquer host de dev passa para qualquer path (warning é
  // emitido pelo middleware, não aqui — função pura).
  if (isDevHost(normalized)) {
    return { allowed: true, reason: 'dev_permissive' };
  }

  // Produção sem env vars configuradas → hard-fail em /admin/*
  if (!config.adminHost && !config.customerHost) {
    if (config.isProduction && adminPath) {
      return { allowed: false, reason: 'prod_misconfigured', status: 503 };
    }
    // Sem config + path não-admin → permitido (compat).
    return { allowed: true, reason: 'unknown_host_non_admin' };
  }

  // Com pelo menos um host configurado, aplicar regras.
  const matchAdmin = config.adminHost && normalized === config.adminHost;
  const matchCustomer = config.customerHost && normalized === config.customerHost;

  if (matchAdmin) {
    if (adminPath) return { allowed: true, reason: 'admin_host_admin_path' };
    return { allowed: false, reason: 'admin_host_non_admin', status: 404 };
  }

  if (matchCustomer) {
    if (adminPath) return { allowed: false, reason: 'customer_host_admin_path', status: 404 };
    return { allowed: true, reason: 'customer_host_non_admin' };
  }

  // Host desconhecido (preview deploys, monitor probes, etc.). Defesa em
  // profundidade: bloqueia /admin/*; permite outras rotas (compat).
  if (adminPath) {
    return { allowed: false, reason: 'unknown_host_admin_path', status: 404 };
  }
  return { allowed: true, reason: 'unknown_host_non_admin' };
}

export function readHostnameGateConfigFromEnv(): GateConfig {
  return {
    adminHost: normalizeHost(process.env.NEXT_PUBLIC_ADMIN_HOST ?? null),
    customerHost: normalizeHost(process.env.NEXT_PUBLIC_CUSTOMER_HOST ?? null),
    isProduction: process.env.NODE_ENV === 'production',
  };
}

export type { GateConfig };
