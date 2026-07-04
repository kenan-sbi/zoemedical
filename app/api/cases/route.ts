import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUser } from '@/lib/session';

// Left-column list: patients in the acting user's CLINIC (cases are shared within the team).
export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const patients = await prisma.patient.findMany({
    where: me.clinicId ? { clinicId: me.clinicId } : {},
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { documents: true, records: true } } },
  });
  return NextResponse.json({
    cases: patients.map((p) => ({
      patientId: p.id,
      patientName: p.displayName,
      docCount: p._count.documents,
      recordCount: p._count.records,
      createdAt: p.createdAt,
    })),
  });
}
