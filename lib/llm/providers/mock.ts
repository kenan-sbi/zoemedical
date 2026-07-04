// Deterministic, offline stand-in for a real LLM — zero cost, no keys, no network.
// It detects the calling ROLE by sniffing the system prompt, then returns output in the
// exact shape that role's caller expects. This lets the ENTIRE pipeline run LLM-free.
// Plug in a real model by setting LLM_PROVIDER / <ROLE>_PROVIDER — no call-site changes,
// and the cite-or-drop + provenance contracts are enforced downstream regardless.
import type { LLMProvider } from '../provider';

const DRUGS = [
  'amoxicillin-clavulanate', 'atorvastatin', 'amoxicillin', 'paracetamol', 'clopidogrel',
  'simvastatin', 'lisinopril', 'omeprazole', 'metformin', 'bisoprolol', 'apixaban',
  'warfarin', 'aspirin', 'insulin',
];
const CONDITIONS = [
  'type 2 diabetes mellitus', 'type 2 diabetes', 'atrial fibrillation', 'myocardial infarction',
  'lv dysfunction', 'appendicitis', 'hypertension', 'palpitations', 'chest pain',
  'shortness of breath', 'ischemia', 'diabetes',
];
const PROCEDURES = ['appendectomy', 'echocardiogram', 'lipid panel', 'follow-up', 'ecg'];
const NEG_CUES = ['no evidence of', 'no known', 'denies', 'ruled out', 'negative for'];
const UNIT_RE = /([A-Za-z][A-Za-z0-9 ]*?)\s+(\d+(?:\.\d+)?)\s*(mg\/dL|ng\/mL|mmol\/L|mmHg|%)/;
const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

// Pull the clinical date stated in a span: YYYY-MM-DD | YYYY-MM | "Mar 2022" | YYYY.
function effectiveFrom(seg: string): string | null {
  const iso = seg.match(/\b(?:19|20)\d{2}[-/](?:0[1-9]|1[0-2])(?:[-/](?:0[1-9]|[12]\d|3[01]))?\b/);
  if (iso) return iso[0].replace(/\//g, '-');
  const named = seg.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+((?:19|20)\d{2})\b/i);
  if (named) return `${named[2]}-${MONTHS[named[1].slice(0, 3).toLowerCase()]}`;
  const yr = seg.match(/\b(?:19|20)\d{2}\b/);
  return yr ? yr[0] : null;
}

// Split into verbatim spans. Split on newlines/semicolons and sentence-final periods only —
// NOT on decimal points (so "8.1%") or in-date hyphens.
function segments(doc: string): string[] {
  return doc.split(/[\n;]+|\.(?=\s|$)/).map((s) => s.trim()).filter((s) => s.length >= 4);
}

function classify(seg: string) {
  const low = seg.toLowerCase();
  const negated = NEG_CUES.some((c) => low.includes(c));
  const assertion = negated ? 'RULED_OUT' : /history|pmh|since \d{4}/.test(low) ? 'HISTORICAL' : 'CONFIRMED';

  const unit = seg.match(UNIT_RE);
  if (unit) {
    const flag = /elevated|high|low|abnormal/i.exec(seg)?.[0];
    return { type: 'OBSERVATION', display: unit[1].trim(), payload: { value: unit[2], unit: unit[3], ...(flag ? { flag: flag.toLowerCase() } : {}) }, negated, assertion };
  }
  const drug = DRUGS.find((d) => low.includes(d));
  if (drug) {
    // dose can appear anywhere in the span (e.g. "increased to 40 mg"), not just after the drug.
    const dose = seg.match(/([0-9.]+\s*(?:mg|mcg|g|units)\b(?:\s+[a-zA-Z]+)?)/i);
    const stopped = /stopped|discontinued|ceased|held|d\/c/i.test(seg);
    const started = /started|initiated|commenced|began|switched to|increased to|reduced to|titrated/i.test(seg);
    const status = stopped ? 'stopped' : started ? 'started' : undefined;
    return { type: 'MEDICATION', display: cap(drug), payload: { drug: cap(drug), ...(dose ? { dose: dose[1].trim() } : {}), ...(status ? { status } : {}) }, negated, assertion };
  }
  if (low.includes('allerg') || low.includes('penicillin') || low.includes('sulfa')) {
    return { type: 'ALLERGY', display: cap((low.match(/penicillin|sulfa[a-z ]*|[a-z]+(?= allerg)/) || ['Allergy'])[0].trim()), payload: { substance: seg }, negated, assertion };
  }
  const cond = CONDITIONS.find((c) => low.includes(c));
  if (cond) return { type: 'CONDITION', display: cap(cond), payload: { name: cond }, negated, assertion };
  const proc = PROCEDURES.find((p) => low.includes(p));
  if (proc) return { type: 'PROCEDURE', display: cap(proc), payload: { name: proc }, negated, assertion };
  return null;
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function readerOutput(doc: string): string {
  const facts: any[] = [];
  const seen = new Set<string>();
  for (const seg of segments(doc)) {
    const c = classify(seg);
    if (!c) continue;
    const key = c.type + '|' + seg.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({
      ...c,
      sourceText: seg,                       // verbatim substring → passes cite-or-drop
      confidence: c.negated ? 0.6 : 0.9,     // negated → NEEDS_REVIEW, exercises the threshold
      effective: effectiveFrom(seg),         // clinical date read from the span (or null)
    });
  }
  return JSON.stringify(facts);
}

function analyzerOutput(userJson: string): string {
  let ctx: any = {};
  try { ctx = JSON.parse(userJson); } catch {}
  const records: any[] = ctx.records ?? [];
  const q: string = (ctx.question ?? '').toLowerCase();
  const generate = /draft|write|generate|letter|referral|discharge|note|compose/.test(q);
  const byType = (t: string) => records.filter((r) => r.type === t && !r.negated);
  const line = (r: any) => `${r.display}${r.payload?.value ? ` ${r.payload.value} ${r.payload.unit ?? ''}`.trim() : ''}`;

  if (!generate) {
    const meds = byType('MEDICATION').map(line);
    const conds = byType('CONDITION').map(line);
    const allerg = byType('ALLERGY').map((r) => r.display);
    const parts = [
      conds.length ? `Conditions: ${conds.join(', ')}.` : '',
      meds.length ? `Medications: ${meds.join(', ')}.` : '',
      allerg.length ? `Allergies: ${allerg.join(', ')}.` : '',
    ].filter(Boolean);
    return JSON.stringify({
      mode: 'answer',
      answer: parts.length ? `Based on the extracted records — ${parts.join(' ')}` : 'No matching facts in this case.',
      title: '', body: '',
      sourceRecordIds: records.map((r) => r.id),
    });
  }

  const title = /insurance/.test(q) ? 'Insurance Pre-Authorization Letter'
    : /referral/.test(q) ? 'Referral Summary'
    : 'Clinical Summary';
  const conds = byType('CONDITION').map(line).join('; ') || '—';
  const meds = byType('MEDICATION').map(line).join('; ') || '—';
  const labs = byType('OBSERVATION').map(line).join('; ') || '—';
  const allerg = byType('ALLERGY').map((r) => r.display).join(', ') || 'None documented';
  const body =
    `To Whom It May Concern:\n\n` +
    `RE: ${ctx.patient?.name ?? 'Patient'}\n\n` +
    `This ${title.toLowerCase()} is generated from the patient's extracted, source-cited records.\n\n` +
    `Active problems: ${conds}.\nCurrent medications: ${meds}.\nRelevant results: ${labs}.\nAllergies: ${allerg}.\n\n` +
    `[DRAFT — generated by the offline stand-in model. Every statement above is drawn only from the case's extracted records.]\n\nSincerely,\n[Reviewing Clinician]`;
  return JSON.stringify({ mode: 'generate', answer: `Drafted the ${title.toLowerCase()}.`, title, body, sourceRecordIds: records.map((r) => r.id) });
}

function verifierOutput(userJson: string): string {
  let v: any = {};
  try { v = JSON.parse(userJson); } catch {}
  const source: string = (v.source ?? '').toLowerCase();
  const claim = v.claim ?? {};
  const tokens: string[] = String(claim.display ?? '').toLowerCase().split(/\s+/).filter((t: string) => t.length > 2);
  const val = claim.payload?.value ? String(claim.payload.value).toLowerCase() : null;
  // Agree if the claim's label tokens (and any numeric value) actually appear in the cited source.
  const labelOk = tokens.length === 0 || tokens.some((t) => source.includes(t));
  const valueOk = !val || source.includes(val);
  const agree = labelOk && valueOk;
  return JSON.stringify({
    agree,
    reason: agree ? 'Claim is supported by the cited source text.' : 'Claim not clearly supported by the cited source text.',
  });
}

export const mock: LLMProvider = {
  name: 'mock',
  async complete({ system, user }) {
    if (/clinical data extractor/i.test(system)) return readerOutput(user);
    if (/clinical fact verifier/i.test(system)) return verifierOutput(user);
    if (/clinical analysis assistant/i.test(system)) return analyzerOutput(user);
    return '[]';
  },
};
