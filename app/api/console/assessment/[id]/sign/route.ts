import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAuthed } from '@/lib/console';

// Physician sign-off — stamps name + license + timestamp and LOCKS the assessment. Mirrors the
// medical-records sign-off: only signed assessments are final. Captures any final adjustments too.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const a = await prisma.hairAssessment.findUnique({ where: { id: params.id } });
  if (!a) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (a.signedAt) return NextResponse.json({ error: 'already signed' }, { status: 409 });

  const b = await req.json().catch(() => ({} as any));
  const name = (b.name ?? '').toString().trim();
  const license = (b.license ?? '').toString().trim();
  if (!name || !license) return NextResponse.json({ error: 'physician name and license required to sign' }, { status: 400 });
  const num = (n: unknown) => (n == null || n === '' ? null : Number.isFinite(+n) ? Math.round(+n) : null);

  // final values default to the agent's estimate if the physician didn't change them
  const est: any = a.estimate ?? {};
  const finalStage = (b.finalStage ?? a.finalStage ?? est.stage ?? '').toString().trim() || null;
  const finalGraftMin = 'finalGraftMin' in b ? num(b.finalGraftMin) : (a.finalGraftMin ?? est.graftMin ?? null);
  const finalGraftMax = 'finalGraftMax' in b ? num(b.finalGraftMax) : (a.finalGraftMax ?? est.graftMax ?? null);
  const finalNotes = 'finalNotes' in b ? (b.finalNotes ?? '').toString().slice(0, 4000) : a.finalNotes;

  const signed = await prisma.hairAssessment.update({
    where: { id: a.id },
    data: { finalStage, finalGraftMin, finalGraftMax, finalNotes, signedName: name, signedLicense: license, signedAt: new Date() },
  });
  // audit trail (reuses the existing AuditLog table)
  await prisma.auditLog.create({ data: { action: 'HAIR_SIGN_OFF', resource: a.id, meta: { name, license, finalStage, finalGraftMin, finalGraftMax } } }).catch(() => {});
  return NextResponse.json({ assessment: signed });
}
