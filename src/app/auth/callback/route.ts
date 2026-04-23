import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const flow = searchParams.get('flow');
  const redirectTo = searchParams.get('redirectTo') ?? '/dashboard';
  const isSignupConfirm = flow === 'signup_confirm';
  const gotrueError = searchParams.get('error') || searchParams.get('error_code');

  // Signup confirmation: GoTrue already marked email_confirmed_at before
  // redirecting here. The code exchange is best-effort — if it fails
  // (e.g., PKCE verifier missing because user clicked from a different
  // browser), the email is still confirmed and the user can log in.
  if (isSignupConfirm) {
    // GoTrue returned an error (expired token, already used, etc).
    // Send user to the link-expired page so they can request a new email.
    if (gotrueError) {
      return NextResponse.redirect(`${origin}/signup/link-expired`);
    }

    if (code) {
      try {
        const supabase = await createClient();
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
          await supabase.auth.signOut();
        }
      } catch (error) {
        console.warn('[auth:callback] signup_confirm exchange failed (ignored)', error);
      }
    }
    return NextResponse.redirect(`${origin}/login?activated=1`);
  }

  // Magic link and other flows: require successful code exchange.
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
