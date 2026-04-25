import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

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

const ADMIN_PUBLIC_PATHS = [
  '/admin/login',
  '/admin/mfa-enroll',
  '/admin/mfa-challenge',
  '/admin/unauthorized',
];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

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
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Required by @supabase/ssr to refresh session cookies before reading user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

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
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
