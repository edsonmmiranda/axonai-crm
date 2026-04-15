import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const redirectTo = searchParams.get('redirectTo') ?? '/dashboard';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=invalid_callback`);
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('[auth:callback] exchange failed', error);
      return NextResponse.redirect(`${origin}/login?error=invalid_code`);
    }
  } catch (error) {
    console.error('[auth:callback] unexpected', error);
    return NextResponse.redirect(`${origin}/login?error=invalid_code`);
  }

  return NextResponse.redirect(`${origin}${redirectTo.startsWith('/') ? redirectTo : '/dashboard'}`);
}
