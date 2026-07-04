import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { caseForPatient } from '@/lib/review';

// Review payload for a patient's case: the case, sign-off state, and every ClinicalRecord
// (with provenance), NEEDS_REVIEW surfaced first.
export async function GET(req: NextRequest) {
  const patientId = req.nextUrl.searchParams.get('patientId');
  if (!patientId) return NextResponse.json({ error: 'patientId required' }, { status: 400 });
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const kase = await caseForPatient(patientId);
  const patient = await prisma.patient.findUnique({ where: { id: patientId } });

  const records = await prisma.clinicalRecord.findMany({
    where: { patientId },
    include: { provenance: true },
    orderBy: { createdAt: 'asc' },
  });
  const rank: Record<string, number> = { NEEDS_REVIEW: 0, EXTRACTED: 1, CORRECTED: 2, ACCEPTED: 3 };
  records.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  const role = dbUser?.role ?? user.role;
  const signedBy = kase.signOff ? await prisma.user.findUnique({ where: { id: kase.signOff.userId } }) : null;
  const needsReview = records.filter((r) => r.status === 'NEEDS_REVIEW').length;

  return NextResponse.json({
    patient: patient ? { id: patient.id, displayName: patient.displayName } : null,
    case: { id: kase.id, procedure: kase.procedure },
    locked: !!kase.signOff,
    signOff: kase.signOff
      ? { at: kase.signOff.createdAt, license: kase.signOff.license, name: signedBy?.name ?? null }
      : null,
    needsReview,
    records,
    me: {
      id: user.id,
      role,
      name: dbUser?.name ?? null,
      license: dbUser?.license ?? null,
      canSign: role === 'REVIEWER' || role === 'OWNER',
    },
  });
}
