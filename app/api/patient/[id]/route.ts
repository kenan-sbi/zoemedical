import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUser } from '@/lib/session';

// Rename a patient.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({} as any));
  const displayName = (body?.displayName ?? '').trim();
  if (!displayName) return NextResponse.json({ error: 'displayName required' }, { status: 400 });
  const p = await prisma.patient.findUnique({ where: { id: params.id } });
  if (!p) return NextResponse.json({ error: 'patient not found' }, { status: 404 });
  const updated = await prisma.patient.update({ where: { id: params.id }, data: { displayName } });
  await prisma.auditLog.create({ data: { userId: user.id, action: 'RENAME_PATIENT', resource: params.id, meta: { from: p.displayName, to: displayName } } });
  return NextResponse.json({ id: updated.id, displayName: updated.displayName });
}

// Delete a patient and EVERYTHING derived from them, FK-safe. Records and their provenance go
// together, so nothing is orphaned. This is a full removal — used deliberately.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const p = await prisma.patient.findUnique({ where: { id: params.id } });
  if (!p) return NextResponse.json({ error: 'patient not found' }, { status: 404 });

  const docs = await prisma.document.findMany({ where: { patientId: params.id }, select: { id: true } });
  const docIds = docs.map((d) => d.id);
  const cases = await prisma.case.findMany({ where: { patientId: params.id }, select: { id: true } });
  const caseIds = cases.map((c) => c.id);

  await prisma.clinicalRecord.deleteMany({ where: { patientId: params.id } });
  await prisma.provenance.deleteMany({ where: { documentId: { in: docIds } } });
  await prisma.review.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.signOff.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.case.deleteMany({ where: { patientId: params.id } });
  await prisma.processingJob.deleteMany({ where: { documentId: { in: docIds } } });
  await prisma.document.deleteMany({ where: { patientId: params.id } });
  await prisma.patient.delete({ where: { id: params.id } });
  await prisma.auditLog.create({ data: { userId: user.id, action: 'DELETE_PATIENT', resource: params.id, meta: { name: p.displayName, docs: docIds.length } } });
  return NextResponse.json({ ok: true, removedDocuments: docIds.length });
}
