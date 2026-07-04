import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { prisma } from '@/lib/db';
import '@/lib/llm'; // register providers
import { getProvider, MODEL_ROUTING } from '@/lib/llm/provider';
import { buildSummaryInput } from '@/lib/resolve';
import { readCache, writeCache } from '@/lib/casecache';

// A stable fingerprint of the record set — changes on any add/delete/correction, so the cached
// summary is reused until the underlying facts actually change.
function fingerprint(records: { id: string; status: string; effective: Date | null; effectiveApprox?: boolean; negated: boolean; coding: unknown }[]) {
  const sig = records
    .map((r) => `${r.id}:${r.status}:${r.effective ? +new Date(r.effective) : 0}:${r.effectiveApprox ? 'a' : ''}:${r.negated}:${(r.coding as any)?.display ?? ''}`)
    .sort()
    .join('|');
  return createHash('sha256').update(sig).digest('hex');
}

// One/two-sentence problem-oriented synopsis for the top of the chart — ANALYZER role,
// grounded STRICTLY in the patient's extracted facts (no invention, no ruled-out-as-present).
const SUMMARY_SYSTEM = `You are a physician writing the summary at the top of a patient's chart for a colleague who has 30 seconds.
You are given the patient's ALREADY reconciled and classified data as JSON, with these fields:
  demographics {sex, age}; activeProblems[]; resolvedHistorical[]; medications{current[], past[]} (past = stopped or completed chemotherapy);
  keyResults[] (grouped by analyte with latest + trend); allergies[]; procedures[]; ruledOut[] (findings explicitly stated ABSENT); familyHistory[].
Write a RICH but strictly factual summary. HARD RULES:
- Present items in the section they are given in. Do NOT reclassify, and do NOT list any item in more than one section.
- "Ruled out" contains only explicitly-absent findings — NEVER put a real diagnosis (e.g. the patient's actual cancer) there.
- Use ONLY the provided data. Never invent diagnoses, demographics, dates, or values.
Format (Markdown):
- Open with a 2–4 sentence NARRATIVE: age/sex if given, the major active/chronic problems and their status, and the trajectory over time.
- Then concise bullet sections under short bold headings, using "- " bullets, OMITTING any empty section:
  **Active problems** (from activeProblems — status/laterality/since)
  **Medications** (current from medications.current with dose/since; then a brief "Past/completed:" line from medications.past)
  **Key results** (from keyResults — analyte: latest value + date, with trend if present)
  **Allergies** · **Procedures** · **Resolved / historical** (from resolvedHistorical) · **Family history**
  **Ruled out** (only if ruledOut is non-empty)
- Keep bullets tight. Return ONLY Markdown (narrative + bullets). No preamble, no JSON, no code fences.`;

// ROLE LENS — same source-cited facts, reframed for the reader. Only the emphasis/voice changes.
const ROLE_LEAD: Record<string, string> = {
  surgeon: `You are writing for the OPERATING SURGEON. Frame everything by PERI-OPERATIVE relevance and lead with it: bleeding / anticoagulation, cardiac-anaesthetic risk, active infection, diabetes / steroids and wound healing, renal or hepatic function affecting drug dosing, relevant prior surgery and anatomy, and any medication that must be held or managed around surgery. Put what affects the operation first.`,
  referring: `You are writing a REFERRAL HANDOFF to a specialist. Frame it as: the reason for referral (the dominant active problem), what has already been worked up or tried, the key results and current medications the specialist needs, and the outstanding question you are asking them to address. Lead with the referral picture.`,
  insurer: `You are writing for an INSURER / utilization reviewer. Frame by DOCUMENTATION COMPLETENESS and MEDICAL NECESSITY: the documented diagnoses (include any codes present), the procedures/services and the conditions that justify them, medication necessity, and any documentation GAPS or unresolved items. Be neutral and factual — document, don't advocate.`,
  patient: `You are writing FOR THE PATIENT to read at home. Warm, plain language at about a 6th-grade level; explain any medical term in everyday words. Be reassuring and clear. No alarming phrasing and no precise clinical jargon.`,
};
const FMT_CLINICAL = `Format (Markdown): open with a 2–4 sentence narrative reframed for THIS reader, then concise "- " bullet sections under short bold headings, ordered with what matters most to this reader FIRST, omitting empty sections. Return ONLY Markdown — no preamble, no code fences.`;
const FMT_PATIENT = `Format (Markdown): a short warm narrative, then simple bold sections — **Your main conditions**, **Your medicines and what they are for**, **Your recent test results (in plain words)**, **What we are keeping an eye on**. Return ONLY Markdown, no jargon, no code fences.`;
const DATA_DESC = `You are given the patient's ALREADY reconciled and classified data as JSON: demographics {sex, age}; activeProblems[]; resolvedHistorical[]; symptoms[]; medications{current[], past[]}; keyResults[] (analyte with latest+trend); allergies[]; procedures[]; ruledOut[] (explicitly ABSENT); familyHistory[].`;
const SHARED_RULES = `HARD RULES: Use ONLY the provided data — never invent diagnoses, values, or dates. "Ruled out" is explicitly-absent findings only; never present one as a real diagnosis. Do not reclassify items. The underlying FACTS are identical for every reader — only the framing, ordering, and voice change for this audience.`;
function roleSystem(role: string): string {
  const lead = ROLE_LEAD[role] ?? ROLE_LEAD.surgeon;
  return `${lead}\n\n${DATA_DESC}\n${SHARED_RULES}\n${role === 'patient' ? FMT_PATIENT : FMT_CLINICAL}`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({} as any));
  const force = body?.force === true;
  const role = ['surgeon', 'referring', 'insurer', 'patient'].includes(body?.role) ? body.role : null;
  const kase = await prisma.case.findUnique({ where: { id: params.id } });
  if (!kase) return NextResponse.json({ error: 'case not found' }, { status: 404 });

  const records = await prisma.clinicalRecord.findMany({
    where: { patientId: kase.patientId },
    include: { provenance: true },
    orderBy: { effective: 'asc' },
  });
  if (records.length === 0) return NextResponse.json({ summary: '', cached: false });

  // Cache: reuse the stored (default) summary unless the record set changed (or force). Role-lensed
  // summaries are generated fresh and cached client-side — the persisted Case.summary is untouched.
  const key = fingerprint(records);
  if (!role && !force && kase.summary && kase.summaryKey === key) {
    return NextResponse.json({ summary: kase.summary, cached: true });
  }
  // Role-lensed summaries persist too (fingerprint+role keyed) — free on reload until facts change.
  if (role && !force) {
    const cached = await readCache(kase.id, 'summary', key, role);
    if (cached) return NextResponse.json({ summary: cached, role, cached: true });
  }

  const patient = await prisma.patient.findUnique({ where: { id: kase.patientId } });
  const ident: any = (patient?.identifiers as any) ?? {};
  const age = ident.birthYear ? new Date().getUTCFullYear() - Number(ident.birthYear) : null;
  // Reconcile + classify server-side so the model presents clean data instead of re-deriving it.
  const input = buildSummaryInput(records as any, { sex: ident.sex ?? null, age: age && age > 0 && age < 130 ? age : null });

  const routing = MODEL_ROUTING.ANALYZER;
  const provider = getProvider(routing.provider);
  const raw = await provider.complete({
    system: role ? roleSystem(role) : SUMMARY_SYSTEM,
    user: JSON.stringify({ patient: patient?.displayName ?? null, ...input }),
    reasoning: routing.reasoning,
    temperature: routing.temperature,
    json: false, // prose/markdown, not JSON
  });
  const summary = raw.replace(/```/g, '').trim();
  // Persist: default summary on the Case; role lenses in the fingerprint-keyed cache.
  if (!role) await prisma.case.update({ where: { id: params.id }, data: { summary, summaryKey: key } });
  else await writeCache(kase.id, 'summary', key, summary, role);
  return NextResponse.json({ summary, role, provider: provider.name, cached: false });
}
