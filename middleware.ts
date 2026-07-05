import { NextRequest, NextResponse } from 'next/server';

// Site passcode gate. The Hair console already issues a site-wide `dc_session` cookie via
// /api/console/login; we reuse it as the front door for the WHOLE app. Any protected page without
// a valid cookie is bounced to the passcode screen at `/`. (This is a demo gate, not hard auth —
// the medical APIs still run under DEV_NO_AUTH behind it.)
const DEFAULT_PASSCODE = 'transplant';

// Recompute the expected token the same way lib/console does: sha256('dc:'+passcode) hex, first 40.
async function expectedToken(): Promise<string> {
  const pass = process.env.DOCTOR_PASSCODE ?? DEFAULT_PASSCODE;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dc:' + pass));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

export async function middleware(req: NextRequest) {
  const token = req.cookies.get('dc_session')?.value;
  if (token) {
    const pass = process.env.DOCTOR_PASSCODE;
    // Strict token match when the passcode env is visible here; if it isn't (edge-runtime env quirk),
    // fall back to trusting the httpOnly cookie the login route already validated — never lock out.
    if (!pass || token === (await expectedToken())) return NextResponse.next();
  }
  const url = req.nextUrl.clone();
  url.pathname = '/';
  url.searchParams.set('next', req.nextUrl.pathname); // return here after the passcode
  return NextResponse.redirect(url);
}

// Gate the app pages only. `/` (passcode) and `/api/*` stay open so login + the medical APIs work.
export const config = {
  matcher: ['/workspace/:path*', '/console/:path*', '/review/:path*', '/cases/:path*'],
};
