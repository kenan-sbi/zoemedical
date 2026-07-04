import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { logAudit } from '@/lib/audit';

// Create a patient in the acting user's clinic (shared with the team). Coordinators may create.
export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const displayName = (body?.displayName ?? '').trim();
  if (!displayName) return NextResponse.json({ error: 'displayName required' }, { status: 400 });

  const patient = await prisma.patient.create({ data: { displayName, clinicId: user.clinicId ?? undefined } });
  await logAudit(user, 'CREATE', patient.id, { name: displayName });
  return NextResponse.json({ id: patient.id, displayName: patient.displayName });
}
