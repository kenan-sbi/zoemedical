import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import '@/lib/llm'; // register providers
import { getProvider, MODEL_ROUTING } from '@/lib/llm/provider';
import { buildSummaryInput } from '@/lib/resolve';
import { recordFingerprint, readCache, writeCache } from '@/lib/casecache';

// CLINICAL ATTENTION — decision-support, not diagnosis. The ANALYZER reasons over the patient's
// already reconciled + source-cited facts and surfaces the 5–8 things a clinician should notice.
// It does NOT touch extraction/dedup/dating; it is a read-only projection over the verified facts.
const ATTENTION_SYSTEM = `You are a clinical decision-support assistant helping a physician triage a chart. You are given the patient's ALREADY reconciled, classified, and source-cited facts as JSON (demographics, activeProblems[], resolvedHistorical[], symptoms[], medications{current[],past[]}, keyResults[] (labs grouped by analyte with a dated trend), allergies[], procedures[], ruledOut[], familyHistory[]), plus "asOf" (today's date).

Your job: surface the 5–8 MOST important things the clinician should NOTICE — a prioritized attention list. Consider these lenses (include an item only when the data genuinely supports it):
- Rising / abnormal TRENDS: a lab trend moving the wrong way or out of range (e.g. worsening renal function, rising disease-activity marker, falling complement, dropping counts). Quote the actual values+dates from keyResults.
- STALE but critical: an important marker or clearance whose most recent value is old relative to "asOf" and should probably be rechecked.
- REFERENCED but unresolved: a problem or finding that is active/suspected with no evidence of resolution or follow-up.
- Drug INTERACTIONS / contraindications / MONITORING gaps: e.g. an interaction between two current medications, a drug that needs monitoring given a problem (e.g. warfarin without a recent INR), or a medication–allergy conflict.
- CROSS-FACT connections: link facts that together suggest something (e.g. "avascular necrosis + long-term corticosteroids — likely steroid complication", "recurrent thrombosis + antiphospholipid syndrome").

HARD RULES:
- Use ONLY the provided facts. Never invent values, dates, drugs, or diagnoses.
- This is DECISION SUPPORT for a physician — frame every item as something to CONSIDER / REVIEW / RECHECK / CORRELATE, never as an autonomous diagnosis or a definitive claim. Never instruct to start/stop a drug outright.
- Each item MUST cite the specific source facts it is based on (by their names/values/dates as they appear in the JSON).
- Prioritize: put the most clinically consequential items first. Keep it to 5–8 items; if fewer are genuinely warranted, return fewer. Be concise.

Return ONLY a JSON object of this exact shape (no prose, no markdown fences):
{"items": [ {"priority": "high"|"medium"|"low", "category": "trend"|"stale"|"unresolved"|"interaction"|"contraindication"|"monitoring"|"connection", "title": "<short, e.g. 'Rising anti-dsDNA with falling complement'>", "detail": "<1–2 sentences of decision-support framing>", "sources": ["<fact reference, e.g. 'Anti-dsDNA 145→48 IU/mL (2023→2025)'>", "..."] } ] }`;

type AttentionItem = { priority: string; category: string; title: string; detail: string; sources: string[] };

function parseItems(raw: string): AttentionItem[] {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  let v: any;
  try { v = JSON.parse(cleaned); } catch { const m = cleaned.match(/[\[{][\s\S]*[\]}]/); if (m) { try { v = JSON.parse(m[0]); } catch {} } }
  const arr = Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : [];
  return arr
    .filter((x: any) => x && typeof x.title === 'string')
    .slice(0, 8)
    .map((x: any) => ({
      priority: ['high', 'medium', 'low'].includes(x.priority) ? x.priority : 'medium',
      category: typeof x.category === 'string' ? x.category : 'connection',
      title: String(x.title),
      detail: typeof x.detail === 'string' ? x.detail : '',
      sources: Array.isArray(x.sources) ? x.sources.filter((s: any) => typeof s === 'string').slice(0, 6) : [],
    }));
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const force = await req.json().then((b) => b?.force === true).catch(() => false);
  const kase = await prisma.case.findUnique({ where: { id: params.id } });
  if (!kase) return NextResponse.json({ error: 'case not found' }, { status: 404 });

  const records = await prisma.clinicalRecord.findMany({
    where: { patientId: kase.patientId },
    include: { provenance: true },
    orderBy: { effective: 'asc' },
  });
  if (records.length === 0) return NextResponse.json({ items: [] });

  // CACHE: reuse the stored analysis unless the facts changed (fingerprint) or the caller forces it.
  const fp = recordFingerprint(records as any);
  if (!force) {
    const cached = await readCache(kase.id, 'attention', fp);
    if (cached) return NextResponse.json({ items: cached, cached: true });
  }

  const patient = await prisma.patient.findUnique({ where: { id: kase.patientId } });
  const ident: any = (patient?.identifiers as any) ?? {};
  const age = ident.birthYear ? new Date().getUTCFullYear() - Number(ident.birthYear) : null;
  const input = buildSummaryInput(records as any, { sex: ident.sex ?? null, age: age && age > 0 && age < 130 ? age : null });

  const routing = MODEL_ROUTING.ANALYZER;
  const provider = getProvider(routing.provider);
  const raw = await provider.complete({
    system: ATTENTION_SYSTEM,
    user: JSON.stringify({ asOf: new Date().toISOString().slice(0, 10), ...input }),
    reasoning: routing.reasoning,
    temperature: routing.temperature,
    json: true,
  });
  const items = parseItems(raw);
  await writeCache(kase.id, 'attention', fp, items); // free on the next reload until facts change
  return NextResponse.json({ items, provider: provider.name, cached: false });
}
