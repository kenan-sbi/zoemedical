import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAuthed } from '@/lib/console';

// GET — all cases (library + test uploads). POST — create a case.
export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const cases = await prisma.hairCase.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ cases });
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const sex = b.sex === 'female' ? 'female' : b.sex === 'male' ? 'male' : null;
  if (!sex) return NextResponse.json({ error: 'sex (male/female) required' }, { status: 400 });
  if (!b.stage || typeof b.stage !== 'string') return NextResponse.json({ error: 'stage required' }, { status: 400 });
  const num = (n: unknown) => (n == null || n === '' ? null : Number.isFinite(+n) ? Math.round(+n) : null);

  const created = await prisma.hairCase.create({
    data: {
      sex,
      stage: b.stage.trim(),
      graftMin: num(b.graftMin),
      graftMax: num(b.graftMax),
      technique: ['FUE', 'FUT', 'DHI'].includes(b.technique) ? b.technique : null,
      notes: typeof b.notes === 'string' ? b.notes.slice(0, 4000) : null,
      photos: b.photos && typeof b.photos === 'object' ? b.photos : {},
      isTest: !!b.isTest,
      estimate: b.estimate && typeof b.estimate === 'object' ? b.estimate : undefined,
    },
  });
  return NextResponse.json({ case: created });
}
