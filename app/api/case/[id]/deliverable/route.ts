import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import '@/lib/llm'; // register providers
import { getProvider, MODEL_ROUTING } from '@/lib/llm/provider';
import { buildSummaryInput } from '@/lib/resolve';
import { currentUser } from '@/lib/session';

// DELIVERABLE GENERATOR — on-demand referral/board packet or plain-language patient summary, in
// English or Arabic (RTL). Grounded STRICTLY in the patient's reconciled, source-cited facts (the
// same verified projection the summary/attention use). Generated deliverables are PERSISTED against
// the case in the existing AuditLog table (action=DELIVERABLE) — no schema change, no clinical
// data-layer change. One saved entry per (type, lang); regenerating replaces it.

// List persisted deliverables for a case (newest first).
async function listDeliverables(caseId: string) {
  const rows = await prisma.auditLog.findMany({ where: { action: 'DELIVERABLE', resource: caseId }, orderBy: { createdAt: 'desc' } });
  return rows.map((r) => ({ id: r.id, createdAt: r.createdAt, ...((r.meta as any) ?? {}) }));
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const kase = await prisma.case.findUnique({ where: { id: params.id }, include: { signOff: true } });
  if (!kase) return NextResponse.json({ error: 'case not found' }, { status: 404 });
  return NextResponse.json({ deliverables: await listDeliverables(kase.id), signed: !!kase.signOff });
}

const REFERRAL_SYSTEM = `You are a physician preparing a REFERRAL / MDT board summary packet for a colleague. You are given the patient's ALREADY reconciled, classified, source-cited facts as JSON (demographics, activeProblems[], resolvedHistorical[], symptoms[], medications{current[],past[]}, keyResults[] with dated trends, allergies[], procedures[], ruledOut[], familyHistory[]).
Produce a structured clinical handover in Markdown with these short bold sections, OMITTING any that are empty:
  **Patient** (age/sex if given)
  **Reason for referral / review** (infer the single dominant active problem and its current status)
  **Active problems** (grouped, most significant first; include laterality/since)
  **Current medications** (drug + dose)
  **Key results** (analyte: latest value + date, with the trend when present)
  **Allergies**
  **Relevant history / procedures**
  **Summary & question for the team** (2–3 sentences)
HARD RULES: Use ONLY the provided facts — never invent diagnoses, values, dates, or drugs. Be concise and professional. This is a draft for physician review.`;

const PATIENT_SYSTEM = `You are a kind clinician writing a PLAIN-LANGUAGE health summary FOR THE PATIENT to take home. You are given the patient's ALREADY reconciled, source-cited facts as JSON.
Write warmly and simply, at about a 6th-grade reading level — explain any medical term in everyday words. Markdown, with these short bold sections (omit empty ones):
  **Your main health conditions** (what they are, in plain words)
  **Your medicines and what they are for** (name + why, simply)
  **Your recent test results** (what they mean in plain terms; note if improving)
  **What we are keeping an eye on**
  **Questions you can ask your care team**
HARD RULES: Use ONLY the provided facts — never invent anything. Do not alarm; be clear and reassuring. Do not give new medical advice or change any treatment. This is a summary of the record, for the patient.`;

function langInstruction(lang: string): string {
  if (lang === 'ar') {
    return `\n\nWrite the ENTIRE document in Modern Standard Arabic (العربية الفصحى) — medically accurate and natural, right-to-left. Keep the Markdown structure and bold section headings, but translate the heading text into Arabic too. You may keep drug brand names or lab acronyms in Latin script only where there is no common Arabic term. Output Arabic only — no English sentences.`;
  }
  return `\n\nWrite in clear, plain English.`;
}

const TITLES: Record<string, { en: string; ar: string }> = {
  referral: { en: 'Referral / Board Summary', ar: 'ملخص إحالة / لجنة طبية' },
  patient: { en: 'Your Health Summary', ar: 'ملخص حالتك الصحية' },
};

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { type = 'referral', lang = 'en' } = await req.json().catch(() => ({} as any));
  const kind = type === 'patient' ? 'patient' : 'referral';
  const language = lang === 'ar' ? 'ar' : 'en';

  const kase = await prisma.case.findUnique({ where: { id: params.id }, include: { signOff: true } });
  if (!kase) return NextResponse.json({ error: 'case not found' }, { status: 404 });

  const records = await prisma.clinicalRecord.findMany({
    where: { patientId: kase.patientId },
    include: { provenance: true },
    orderBy: { effective: 'asc' },
  });
  if (records.length === 0) return NextResponse.json({ error: 'no facts to summarize' }, { status: 400 });

  const patient = await prisma.patient.findUnique({ where: { id: kase.patientId } });
  const ident: any = (patient?.identifiers as any) ?? {};
  const age = ident.birthYear ? new Date().getUTCFullYear() - Number(ident.birthYear) : null;
  const input = buildSummaryInput(records as any, { sex: ident.sex ?? null, age: age && age > 0 && age < 130 ? age : null });

  const routing = MODEL_ROUTING.ANALYZER;
  const provider = getProvider(routing.provider);
  const raw = await provider.complete({
    system: (kind === 'patient' ? PATIENT_SYSTEM : REFERRAL_SYSTEM) + langInstruction(language),
    user: JSON.stringify({ patient: patient?.displayName ?? null, ...input }),
    reasoning: routing.reasoning,
    temperature: routing.temperature,
    json: false, // prose/markdown
  });

  const meta = {
    title: TITLES[kind][language],
    body: raw.replace(/```/g, '').trim(),
    type: kind,
    lang: language,
    dir: language === 'ar' ? 'rtl' : 'ltr',
    signedAtGeneration: !!kase.signOff, // whether the case was signed when this was generated
    sourceRecordIds: records.map((r) => r.id), // provenance: every record this drew from
  };

  // PERSIST: replace any prior entry of the same (type, lang), then store the new one on the case.
  const existing = await prisma.auditLog.findMany({ where: { action: 'DELIVERABLE', resource: kase.id } });
  const dupes = existing.filter((e) => (e.meta as any)?.type === kind && (e.meta as any)?.lang === language);
  if (dupes.length) await prisma.auditLog.deleteMany({ where: { id: { in: dupes.map((d) => d.id) } } });
  const user = await currentUser(req);
  const saved = await prisma.auditLog.create({ data: { action: 'DELIVERABLE', resource: kase.id, userId: user?.id ?? null, meta } });

  return NextResponse.json({ id: saved.id, createdAt: saved.createdAt, ...meta, signed: !!kase.signOff, provider: provider.name });
}
