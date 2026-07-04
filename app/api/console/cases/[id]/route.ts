import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAuthed } from '@/lib/console';

// PATCH — edit a case's fields. DELETE — remove a case.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const num = (n: unknown) => (n == null || n === '' ? null : Number.isFinite(+n) ? Math.round(+n) : null);
  const data: any = {};
  if (b.sex === 'male' || b.sex === 'female') data.sex = b.sex;
  if (typeof b.stage === 'string' && b.stage.trim()) data.stage = b.stage.trim();
  if ('graftMin' in b) data.graftMin = num(b.graftMin);
  if ('graftMax' in b) data.graftMax = num(b.graftMax);
  if ('technique' in b) data.technique = ['FUE', 'FUT', 'DHI'].includes(b.technique) ? b.technique : null;
  if ('notes' in b) data.notes = typeof b.notes === 'string' ? b.notes.slice(0, 4000) : null;
  if (b.photos && typeof b.photos === 'object') data.photos = b.photos;
  const updated = await prisma.hairCase.update({ where: { id: params.id }, data }).catch(() => null);
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ case: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  await prisma.hairCase.delete({ where: { id: params.id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
