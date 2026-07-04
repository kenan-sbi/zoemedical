import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAuthed, runAssessment, getRulebook, voiceSummary } from '@/lib/console';

export const runtime = 'nodejs';
export const maxDuration = 60;

// GET — list assessments (newest first). POST — create + RUN the agent, persist the result.
export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const assessments = await prisma.hairAssessment.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ assessments });
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const sex = b.sex === 'female' ? 'female' : 'male';
  const photos = b.photos && typeof b.photos === 'object' ? b.photos : {};
  if (Object.keys(photos).length === 0) return NextResponse.json({ error: 'upload at least one photo' }, { status: 400 });
  const age = b.age == null || b.age === '' ? null : Math.max(0, Math.min(120, Math.round(+b.age))) || null;
  const duration = typeof b.duration === 'string' ? b.duration.slice(0, 120) : null;

  const result = await runAssessment(photos, { sex, age, duration });

  // ENRICH (not the agent core): re-voice the summary in the surgeon's own FAQ/standards.
  const rules = await getRulebook();
  const voiced = await voiceSummary(result, rules.faq ?? [], { sex, age, duration });
  const estimate = { ...result, summary: voiced.summary, appliedFaq: voiced.appliedFaq };

  const created = await prisma.hairAssessment.create({
    data: { sex, age, duration, photos, vision: result.vision as any, estimate: estimate as any },
  });
  // resolve reference cases so the UI can show WHICH of his cases it used
  const refs = await prisma.hairCase.findMany({ where: { id: { in: result.referenceCaseIds } } });
  return NextResponse.json({ assessment: created, references: refs });
}
