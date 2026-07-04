import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import '@/lib/llm';
import { getProvider, MODEL_ROUTING } from '@/lib/llm/provider';

// ROLE LENS for the Clinical Attention panel. Takes the ALREADY-GENERATED flags and writes a short
// reader-specific framing of what to focus on. It does NOT add/remove/re-rank flags — the attention
// generation logic is untouched; this only reframes emphasis for the selected reader.
const LENS: Record<string, string> = {
  surgeon: 'the OPERATING SURGEON — what affects the procedure, anaesthesia, bleeding, and healing',
  referring: 'the REFERRING PHYSICIAN — what to hand off and what the specialist must know',
  insurer: 'an INSURER / utilization reviewer — documentation completeness and medical necessity',
  patient: 'the PATIENT — plain, reassuring language, no jargon',
};

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await req.json().catch(() => ({} as any));
  const role = ['surgeon', 'referring', 'insurer', 'patient'].includes(b?.role) ? b.role : 'surgeon';
  const items = Array.isArray(b?.items) ? b.items : [];
  if (items.length === 0) return NextResponse.json({ lens: '' });
  const kase = await prisma.case.findUnique({ where: { id: params.id } });
  if (!kase) return NextResponse.json({ error: 'case not found' }, { status: 404 });

  const list = items.map((it: any, i: number) => `${i + 1}. [${it.priority}/${it.category}] ${it.title}`).join('\n');
  const system = `You are reframing an EXISTING, already-prioritized clinical-attention list for a specific reader. Write ONE to TWO sentences telling ${LENS[role]} what to focus on AMONG THESE FLAGS, in their frame. Rules: do NOT add, remove, invent, or re-rank flags; refer only to what is listed; ${role === 'patient' ? 'use plain, calm, non-alarming language and explain any term.' : 'be concise and professional.'} Return ONLY JSON: {"lens":"..."}.`;

  const routing = MODEL_ROUTING.ANALYZER;
  const provider = getProvider(routing.provider);
  try {
    const raw = await provider.complete({ system, user: `Flags:\n${list}`, reasoning: routing.reasoning, temperature: 0.2, json: true });
    const j = JSON.parse(raw.replace(/```json/gi, '').replace(/```/g, '').trim());
    return NextResponse.json({ lens: typeof j?.lens === 'string' ? j.lens.trim() : '', role });
  } catch {
    return NextResponse.json({ lens: '', role });
  }
}
