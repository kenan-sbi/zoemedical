import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUser } from '@/lib/session';

// GET — recent audit entries for the clinic (who did what). Optional ?patientId= to scope to a case.
export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const teamIds = me.clinicId
    ? (await prisma.user.findMany({ where: { clinicId: me.clinicId }, select: { id: true } })).map((u) => u.id)
    : [me.id];
  const patientId = req.nextUrl.searchParams.get('patientId');

  const rows = await prisma.auditLog.findMany({
    where: { userId: { in: teamIds }, ...(patientId ? { resource: patientId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId).filter(Boolean) as string[])] } }, select: { id: true, name: true, email: true, role: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  const entries = rows.map((r) => ({ id: r.id, action: r.action, resource: r.resource, meta: r.meta, at: r.createdAt, user: r.userId ? byId.get(r.userId) ?? { id: r.userId } : null }));
  return NextResponse.json({ entries });
}
