import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { loadRecordWithCase, ASSERTIONS } from '@/lib/review';

// Correct a fact: edit payload / negated / assertion, status -> CORRECTED, and append the
// before/after to the reviewer's Review.corrections (the feedback loop).
// The provenance link is NEVER touched here — a correction cannot orphan a citation.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const { record, kase } = await loadRecordWithCase(params.id);
  if (!record) return NextResponse.json({ error: 'record not found' }, { status: 404 });
  if (!kase) return NextResponse.json({ error: 'no case for patient' }, { status: 400 });
  if (kase.signOff) return NextResponse.json({ error: 'case is signed and locked' }, { status: 409 });

  if (body.assertion !== undefined && !ASSERTIONS.includes(body.assertion)) {
    return NextResponse.json({ error: `assertion must be one of ${ASSERTIONS.join(', ')}` }, { status: 400 });
  }

  const before = { payload: record.payload, negated: record.negated, assertion: record.assertion };
  const data: any = { status: 'CORRECTED' };
  if (body.payload !== undefined) data.payload = body.payload;
  if (body.negated !== undefined) data.negated = !!body.negated;
  if (body.assertion !== undefined) data.assertion = body.assertion;
  // NOTE: provenanceId is intentionally absent from `data` — the citation is immutable.

  const updated = await prisma.clinicalRecord.update({ where: { id: record.id }, data });

  const after = { payload: updated.payload, negated: updated.negated, assertion: updated.assertion };
  const entry = { recordId: record.id, before, after, by: user.id, at: new Date().toISOString() };

  const review = await prisma.review.findFirst({ where: { caseId: kase.id, userId: user.id } });
  if (review) {
    const arr = Array.isArray(review.corrections) ? (review.corrections as any[]) : [];
    await prisma.review.update({ where: { id: review.id }, data: { corrections: [...arr, entry] } });
  } else {
    await prisma.review.create({ data: { caseId: kase.id, userId: user.id, corrections: [entry] } });
  }

  return NextResponse.json({ ok: true, status: updated.status });
}
