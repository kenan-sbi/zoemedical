import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUser, can, CAN_MANAGE_TEAM } from '@/lib/session';
import { logAudit } from '@/lib/audit';

const ROLES = ['OWNER', 'CLINICIAN', 'REVIEWER', 'COORDINATOR'];

// GET — the clinic's team (members + roles) and the acting user's permissions.
export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const members = me.clinicId
    ? await prisma.user.findMany({ where: { clinicId: me.clinicId }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, email: true, role: true, license: true } })
    : [];
  const clinic = me.clinicId ? await prisma.clinic.findUnique({ where: { id: me.clinicId } }) : null;
  return NextResponse.json({
    clinic: clinic ? { id: clinic.id, name: clinic.name } : null,
    members,
    me: { id: me.id, role: me.role, canManage: can(me, CAN_MANAGE_TEAM), canSign: ['OWNER', 'REVIEWER'].includes(me.role) },
  });
}

// POST — add a team member (OWNER only). { name, email, role, license? }
export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!can(me, CAN_MANAGE_TEAM)) return NextResponse.json({ error: 'only an OWNER can manage the team' }, { status: 403 });
  const b = await req.json().catch(() => ({} as any));
  const email = (b.email ?? '').toString().trim().toLowerCase();
  const role = ROLES.includes(b.role) ? b.role : 'COORDINATOR';
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });
  if (await prisma.user.findUnique({ where: { email } })) return NextResponse.json({ error: 'a user with that email already exists' }, { status: 409 });
  const user = await prisma.user.create({ data: { email, name: (b.name ?? '').toString().trim() || null, role, license: (b.license ?? '').toString().trim() || null, clinicId: me.clinicId } });
  await logAudit(me, 'TEAM_ADD', user.id, { email, role });
  return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, license: user.license } });
}
