import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import {
  evaluateHostnameGate,
  readHostnameGateConfigFromEnv,
} from '@/lib/middleware/hostnameGate';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill it.`
    );
  }
  return value;
}

const CUSTOMER_PROTECTED_PREFIXES = ['/dashboard'];

const SUSPENSION_BYPASS_PATHS = [
  '/conta-suspensa',
  '/login',
  '/logout',
  '/admin',
];

const ADMIN_PUBLIC_PATHS = [
  '/admin/login',
  '/admin/mfa-enroll',
  '/admin/mfa-challenge',
  '/admin/unauthorized',
  '/admin/accept-invite',
];

const HOSTNAME_GATE_CONFIG = readHostnameGateConfigFromEnv();
let hostnameGateDevWarningEmitted = false;

/**
 * Adiciona domain explícito + SameSite=Strict aos cookies setados pelo Supabase
 * (Sprint admin_13 — RNF-SEC-1). Garante que sessão admin emitida em admin.<host>
 * não vaze para o customer host e vice-versa. Em dev local (sem host configurado
 * ou host inclui localhost), preserva options originais (browsers descartam
 * cookies com domain=localhost).
 */
function isolatedCookieOptions(
  options: CookieOptions | undefined,
  host: string | null,
): CookieOptions {
  const next: CookieOptions = { ...(options ?? {}) };

  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    next.domain = host;
    next.sameSite = 'strict';
  }

  return next;
}

export async function middleware(request: NextRequest) {
  const { pathname: gatePath } = request.nextUrl;
  const requestHost = request.headers.get('host');

  const gateDecision = evaluateHostnameGate(requestHost, gatePath, HOSTNAME_GATE_CONFIG);

  if (
    gateDecision.allowed &&
    gateDecision.reason === 'dev_permissive' &&
    !hostnameGateDevWarningEmitted &&
    !HOSTNAME_GATE_CONFIG.adminHost &&
    !HOSTNAME_GATE_CONFIG.customerHost
  ) {
    hostnameGateDevWarningEmitted = true;
    console.warn(
      '[hostnameGate] running in dev-permissive mode — set NEXT_PUBLIC_ADMIN_HOST and NEXT_PUBLIC_CUSTOMER_HOST in production.'
    );
  }

  if (!gateDecision.allowed) {
    if (gateDecision.status === 503) {
      console.error(
        '[hostnameGate] production misconfigured — NEXT_PUBLIC_ADMIN_HOST/NEXT_PUBLIC_CUSTOMER_HOST missing.'
      );
      return new NextResponse('Origin gate misconfigured', { status: 503 });
    }
    return new NextResponse(null, { status: 404 });
  }

  let response = NextResponse.next({ request });

  const cookieHostName = (() => {
    if (!requestHost) return null;
    return requestHost.trim().toLowerCase().split(':')[0] ?? null;
  })();

  const supabase = createServerClient(
    getEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(
              name,
              value,
              isolatedCookieOptions(options, cookieHostName),
            );
          });
        },
      },
    }
  );

  // Required by @supabase/ssr to refresh session cookies before reading user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = gatePath;

  // ── Customer app protection ──────────────────────────────────────────────
  const isCustomerProtected = CUSTOMER_PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
  if (isCustomerProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(url);
  }

  // ── Org suspension check ─────────────────────────────────────────────────
  // If user is authenticated and the route is a customer route (not admin, not
  // suspension page, not auth pages), check if their org is suspended.
  const isSuspensionBypass = SUSPENSION_BYPASS_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
  if (user && !isSuspensionBypass) {
    const orgId = user.app_metadata?.organization_id as string | undefined;
    if (orgId) {
      const { data: org } = await supabase
        .from('organizations')
        .select('is_active')
        .eq('id', orgId)
        .maybeSingle();

      if (org && (org as { is_active: boolean }).is_active === false) {
        const url = request.nextUrl.clone();
        url.pathname = '/conta-suspensa';
        url.search = '';
        return NextResponse.redirect(url);
      }
    }
  }

  // ── Admin area protection ────────────────────────────────────────────────
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/');
  const isAdminPublic = ADMIN_PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  if (isAdminRoute && !isAdminPublic) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin/login';
      url.search = '';
      return NextResponse.redirect(url);
    }

    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== 'aal2') {
      const url = request.nextUrl.clone();
      url.pathname =
        aal?.nextLevel === 'aal2' ? '/admin/mfa-challenge' : '/admin/mfa-enroll';
      url.search = '';
      return NextResponse.redirect(url);
    }

    // ── MFA re-enroll required (Sprint 11) ─────────────────────────────────
    // Set by mark_admin_password_reset (after admin password reset) or by
    // admin_approve_mfa_reset (step-up). Forces re-enroll before any /admin/*
    // route is served. Cleared by complete_admin_mfa_reenroll or
    // consume_admin_mfa_reset on successful re-enroll.
    const { data: profile } = await supabase
      .from('profiles')
      .select('mfa_reset_required')
      .eq('id', user.id)
      .maybeSingle<{ mfa_reset_required: boolean }>();

    if (profile?.mfa_reset_required) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin/mfa-enroll';
      url.search = '';
      url.searchParams.set('reenroll', 'true');
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
