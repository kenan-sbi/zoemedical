import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { scoreCase } from '@/lib/pipeline/completeness';

// POST: (re)compute and store the completeness score + itemized assessment for a case.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await scoreCase(params.id);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 400 });
  }
}

// GET: read the last stored score/assessment without recomputing.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const kase = await prisma.case.findUnique({
    where: { id: params.id },
    select: { score: true, assessment: true, procedure: true },
  });
  if (!kase) return NextResponse.json({ error: 'case not found' }, { status: 404 });
  return NextResponse.json({ score: kase.score, assessment: kase.assessment ?? null, procedure: kase.procedure ?? 'default' });
}
