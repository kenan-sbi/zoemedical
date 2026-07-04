import { NextRequest, NextResponse } from 'next/server';
import { checkPasscode, isAuthed, DC_COOKIE, DC_TOKEN } from '@/lib/console';

// GET — am I signed in? POST { passcode } — sign in (sets an httpOnly session cookie).
export async function GET(req: NextRequest) {
  return NextResponse.json({ authed: isAuthed(req) });
}

export async function POST(req: NextRequest) {
  const { passcode } = await req.json().catch(() => ({} as any));
  if (!checkPasscode(passcode)) return NextResponse.json({ error: 'Incorrect passcode' }, { status: 401 });
  const res = NextResponse.json({ authed: true });
  res.cookies.set(DC_COOKIE, DC_TOKEN, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ authed: false });
  res.cookies.set(DC_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
