import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import '@/lib/llm'; // side-effect: register LLM providers (gemini) in the Next server process
import { getProvider, MODEL_ROUTING } from '@/lib/llm/provider';
import { ANALYZER_SYSTEM, buildContext, parseAnalyzer } from '@/lib/analyzer';

// Context-aware chat over ONE case's records. Answers questions or GENERATES deliverables,
// strictly from facts already extracted for the case.
export async function POST(req: NextRequest) {
  const { patientId, message } = await req.json().catch(() => ({} as any));
  if (!patientId || !message) return NextResponse.json({ error: 'patientId + message required' }, { status: 400 });

  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  const records = await prisma.clinicalRecord.findMany({
    where: { patientId },
    include: { provenance: true },
    orderBy: { createdAt: 'asc' },
  });
  if (records.length === 0) {
    return NextResponse.json({ mode: 'answer', answer: 'No extracted records for this case yet — upload and extract a document first.', title: '', body: '', sourceRecordIds: [] });
  }

  const routing = MODEL_ROUTING.ANALYZER; // reasoning on, low temperature
  const provider = getProvider(routing.provider);
  const raw = await provider.complete({
    system: ANALYZER_SYSTEM,
    user: buildContext(patient?.displayName, message, records),
    reasoning: routing.reasoning,
    temperature: routing.temperature,
  });

  const result = parseAnalyzer(raw, records.map((r) => r.id));
  return NextResponse.json(result);
}
