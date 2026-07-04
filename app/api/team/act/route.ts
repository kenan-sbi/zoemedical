import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUser, ACT_COOKIE } from '@/lib/session';

// DEV act-as: switch which team member you're acting as, to exercise role restrictions. In
// production this is replaced by real authentication — the acting user is the signed-in user.
export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { userId } = await req.json().catch(() => ({} as any));
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.clinicId !== me.clinicId) return NextResponse.json({ error: 'not a team member' }, { status: 404 });
  const res = NextResponse.json({ ok: true, acting: { id: target.id, name: target.name, role: target.role } });
  res.cookies.set(ACT_COOKIE, target.id, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
  return res;
}
