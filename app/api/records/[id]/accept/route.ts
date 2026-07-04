import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUser, can, CAN_EDIT } from '@/lib/session';
import { logAudit } from '@/lib/audit';
import { loadRecordWithCase } from '@/lib/review';

// Accept a fact as-is: status -> ACCEPTED. Blocked once the case is signed.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!can(user, CAN_EDIT)) return NextResponse.json({ error: 'your role (coordinator) cannot edit clinical facts' }, { status: 403 });

  const { record, kase } = await loadRecordWithCase(params.id);
  if (!record) return NextResponse.json({ error: 'record not found' }, { status: 404 });
  if (kase?.signOff) return NextResponse.json({ error: 'case is signed and locked' }, { status: 409 });

  const updated = await prisma.clinicalRecord.update({
    where: { id: record.id },
    data: { status: 'ACCEPTED' },
  });
  await logAudit(user, 'EDIT', record.patientId, { action: 'accept-fact', recordId: record.id });
  return NextResponse.json({ ok: true, status: updated.status });
}
