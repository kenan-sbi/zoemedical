import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUser } from '@/lib/session';

// Physician sign-off: only REVIEWER/OWNER, only when nothing still NEEDS_REVIEW.
// Creates a SignOff stamped with name + license, locks the case, writes an AuditLog.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({} as any)); // optional { name, license }
  const kase = await prisma.case.findUnique({ where: { id: params.id }, include: { signOff: true } });
  if (!kase) return NextResponse.json({ error: 'case not found' }, { status: 404 });
  if (kase.signOff) return NextResponse.json({ error: 'case already signed' }, { status: 409 });

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  const role = dbUser?.role ?? user.role;
  if (role !== 'REVIEWER' && role !== 'OWNER') {
    return NextResponse.json({ error: 'sign-off requires REVIEWER or OWNER role' }, { status: 403 });
  }

  const outstanding = await prisma.clinicalRecord.count({
    where: { patientId: kase.patientId, status: 'NEEDS_REVIEW' },
  });
  if (outstanding > 0) {
    return NextResponse.json({ error: `${outstanding} fact(s) still need review` }, { status: 409 });
  }

  // Stamp with the reviewer's identity; let them fill in name/license at sign time if missing.
  const name = body.name ?? dbUser?.name ?? null;
  const license = body.license ?? dbUser?.license ?? null;
  if ((body.name && body.name !== dbUser?.name) || (body.license && body.license !== dbUser?.license)) {
    await prisma.user.update({ where: { id: user.id }, data: { name, license } });
  }

  const signOff = await prisma.signOff.create({ data: { caseId: kase.id, userId: user.id, license } });
  await prisma.auditLog.create({
    data: { userId: user.id, action: 'SIGN_OFF', resource: kase.id, meta: { license, name } },
  });

  return NextResponse.json({ ok: true, signOff: { at: signOff.createdAt, name, license } });
}
