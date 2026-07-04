import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAuthed } from '@/lib/console';

// GET one assessment (with the reference cases it used). PATCH the physician's adjustments (blocked
// once signed). DELETE removes it.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const a = await prisma.hairAssessment.findUnique({ where: { id: params.id } });
  if (!a) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const ids: string[] = ((a.estimate as any)?.referenceCaseIds ?? []);
  const references = ids.length ? await prisma.hairCase.findMany({ where: { id: { in: ids } } }) : [];
  return NextResponse.json({ assessment: a, references });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const a = await prisma.hairAssessment.findUnique({ where: { id: params.id } });
  if (!a) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (a.signedAt) return NextResponse.json({ error: 'assessment is signed and locked' }, { status: 409 });
  const b = await req.json().catch(() => ({} as any));
  const num = (n: unknown) => (n == null || n === '' ? null : Number.isFinite(+n) ? Math.round(+n) : null);
  const data: any = {};
  if ('finalStage' in b) data.finalStage = typeof b.finalStage === 'string' ? b.finalStage.trim() : null;
  if ('finalGraftMin' in b) data.finalGraftMin = num(b.finalGraftMin);
  if ('finalGraftMax' in b) data.finalGraftMax = num(b.finalGraftMax);
  if ('finalNotes' in b) data.finalNotes = typeof b.finalNotes === 'string' ? b.finalNotes.slice(0, 4000) : null;
  const updated = await prisma.hairAssessment.update({ where: { id: a.id }, data });
  return NextResponse.json({ assessment: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  await prisma.hairAssessment.delete({ where: { id: params.id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
