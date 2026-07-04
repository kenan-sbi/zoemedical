import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUser } from '@/lib/session';

// Remove a document and everything derived from it. Records and their provenance are deleted
// TOGETHER, so provenance is never orphaned (the cite-or-drop invariant holds in reverse too).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const doc = await prisma.document.findUnique({ where: { id: params.id } });
  if (!doc) return NextResponse.json({ error: 'document not found' }, { status: 404 });

  // A signed case is locked — don't let a document (and its signed-off facts) be removed.
  const kase = await prisma.case.findFirst({ where: { patientId: doc.patientId }, include: { signOff: true } });
  if (kase?.signOff) return NextResponse.json({ error: 'case is signed and locked — cannot remove documents' }, { status: 409 });

  const provs = await prisma.provenance.findMany({ where: { documentId: params.id }, select: { id: true } });
  const provIds = provs.map((p) => p.id);
  const del = await prisma.clinicalRecord.deleteMany({ where: { provenanceId: { in: provIds } } });
  await prisma.provenance.deleteMany({ where: { documentId: params.id } });
  await prisma.processingJob.deleteMany({ where: { documentId: params.id } });
  await prisma.document.delete({ where: { id: params.id } });
  await prisma.auditLog.create({
    data: { userId: user.id, action: 'DELETE_DOCUMENT', resource: params.id, meta: { filename: doc.filename, removedRecords: del.count } },
  });
  // Stored file left on disk (content-addressed; may be shared via hash dedupe) — harmless.
  return NextResponse.json({ ok: true, removedRecords: del.count });
}
