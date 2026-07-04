import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { logAudit } from '@/lib/audit';
import { caseForPatient } from '@/lib/review';
import { MODEL_ROUTING } from '@/lib/llm/provider';
import { fixArabic } from '@/lib/text';

// Verification is only meaningful when a genuinely DIFFERENT real model checked the fact.
// Expose that fact so the UI never shows a "verified" badge under the mock or a same-provider verifier.
function verificationTrusted() {
  const enabled = (process.env.VERIFIER_ENABLED ?? '1') === '1';
  const reader = MODEL_ROUTING.READER.provider;
  const verifier = MODEL_ROUTING.VERIFIER.provider;
  return { trusted: enabled && verifier !== 'mock' && verifier !== reader, reader, verifier };
}

// Everything the workspace needs for one open case: patient, case, source documents, records.
export async function GET(req: NextRequest) {
  const patientId = req.nextUrl.searchParams.get('patientId');
  if (!patientId) return NextResponse.json({ error: 'patientId required' }, { status: 400 });
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) return NextResponse.json({ error: 'patient not found' }, { status: 404 });
  // Clinic isolation: a case is shared within the clinic team only.
  if (patient.clinicId && user.clinicId && patient.clinicId !== user.clinicId) {
    return NextResponse.json({ error: 'this case belongs to another clinic' }, { status: 403 });
  }
  await logAudit(user, 'VIEW', patientId, { name: patient.displayName });

  const kase = await caseForPatient(patientId);
  const docs = await prisma.document.findMany({
    where: { patientId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, filename: true, mimeType: true, createdAt: true, job: { select: { stage: true, status: true, error: true } } },
  });
  // Per-document fact counts (from provenance) so the "done · N" chip survives a reload too.
  const counts = await prisma.provenance.groupBy({ by: ['documentId'], where: { documentId: { in: docs.map((d) => d.id) } }, _count: { _all: true } });
  const countByDoc = new Map(counts.map((c) => [c.documentId, c._count._all]));
  const documents = docs.map((d) => ({ id: d.id, filename: d.filename, mimeType: d.mimeType, createdAt: d.createdAt, job: d.job ?? null, recordCount: countByDoc.get(d.id) ?? 0 }));
  const raw = await prisma.clinicalRecord.findMany({
    where: { patientId },
    include: { provenance: true },
    orderBy: { createdAt: 'asc' },
  });
  // Repair reversed/presentation-form Arabic for display (existing records stored before ingest-time repair).
  const records = raw.map((r) => {
    const c: any = r.coding;
    return {
      ...r,
      coding: c ? { ...c, label: fixArabic(c.label), display: fixArabic(c.display) } : c,
      provenance: r.provenance ? { ...r.provenance, sourceText: fixArabic(r.provenance.sourceText) } : r.provenance,
    };
  });

  const ident: any = (patient.identifiers as any) ?? {};
  const age = ident.birthYear ? new Date().getUTCFullYear() - Number(ident.birthYear) : null;
  return NextResponse.json({
    patient: { id: patient.id, displayName: patient.displayName, sex: ident.sex ?? null, age: age && age > 0 && age < 130 ? age : null },
    case: { id: kase.id, procedure: kase.procedure, signed: !!kase.signOff },
    documents,
    records,
    verification: verificationTrusted(),
  });
}
