import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUser, can, CAN_MANAGE_TEAM } from '@/lib/session';
import { logAudit } from '@/lib/audit';

const ROLES = ['OWNER', 'CLINICIAN', 'REVIEWER', 'COORDINATOR'];

// PATCH — change a member's role (OWNER only). DELETE — remove a member (OWNER only).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await currentUser(req);
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!can(me, CAN_MANAGE_TEAM)) return NextResponse.json({ error: 'only an OWNER can change roles' }, { status: 403 });
  const b = await req.json().catch(() => ({} as any));
  if (!ROLES.includes(b.role)) return NextResponse.json({ error: 'invalid role' }, { status: 400 });
  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target || target.clinicId !== me.clinicId) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const updated = await prisma.user.update({ where: { id: params.id }, data: { role: b.role, ...(typeof b.license === 'string' ? { license: b.license.trim() || null } : {}) } });
  await logAudit(me, 'TEAM_ROLE', target.id, { from: target.role, to: b.role });
  return NextResponse.json({ user: { id: updated.id, name: updated.name, email: updated.email, role: updated.role, license: updated.license } });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await currentUser(req);
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!can(me, CAN_MANAGE_TEAM)) return NextResponse.json({ error: 'only an OWNER can remove members' }, { status: 403 });
  if (params.id === me.id) return NextResponse.json({ error: 'you cannot remove yourself' }, { status: 400 });
  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target || target.clinicId !== me.clinicId) return NextResponse.json({ error: 'not found' }, { status: 404 });
  // keep audit/sign-off history intact — detach from clinic rather than hard-delete
  await prisma.user.update({ where: { id: params.id }, data: { clinicId: null } });
  await logAudit(me, 'TEAM_REMOVE', target.id, { email: target.email });
  return NextResponse.json({ ok: true });
}
