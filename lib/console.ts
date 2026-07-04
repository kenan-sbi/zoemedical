// Doctor Console — standalone helpers: simple passcode auth, photo storage, and the "learn his
// standards" estimator (vision for stage + HIS taught cases for the graft range).
import type { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { prisma } from './db';

// ---- simple auth (single shared passcode for the surgeon) ----
const PASSCODE = process.env.DOCTOR_PASSCODE ?? 'transplant';
export const DC_COOKIE = 'dc_session';
export const DC_TOKEN = createHash('sha256').update('dc:' + PASSCODE).digest('hex').slice(0, 40);
export function checkPasscode(input: unknown) { return typeof input === 'string' && input === PASSCODE; }
export function isAuthed(req: NextRequest) { return req.cookies.get(DC_COOKIE)?.value === DC_TOKEN; }

// ---- photo storage (local, mirrors the existing uploads/ pattern) ----
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export async function savePhoto(buf: Buffer, mime: string): Promise<string> {
  const ext = EXT[mime] ?? 'jpg';
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 24);
  const key = `uploads/console/${hash}.${ext}`;
  await mkdir(join(process.cwd(), 'uploads', 'console'), { recursive: true });
  await writeFile(join(process.cwd(), key), buf);
  return key;
}
export async function readPhoto(key: string): Promise<{ buf: Buffer; mime: string }> {
  if (!/^uploads\/console\//.test(key)) throw new Error('bad key'); // never read outside the console dir
  const buf = await readFile(resolve(process.cwd(), key));
  const ext = key.split('.').pop() ?? 'jpg';
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return { buf, mime };
}

// ---- rulebook (singleton, editable) ----
export const DEFAULT_RULES = {
  densityPerZone: { hairline: 45, mid: 40, crown: 35 }, // target grafts/cm²
  graftRangePerStage: [
    { stage: 'Norwood II', min: 800, max: 1500 },
    { stage: 'Norwood III', min: 1500, max: 2200 },
    { stage: 'Norwood III vertex', min: 1800, max: 2500 },
    { stage: 'Norwood IV', min: 2200, max: 3200 },
    { stage: 'Norwood V', min: 2800, max: 3800 },
    { stage: 'Norwood VI', min: 3200, max: 4500 },
    { stage: 'Norwood VII', min: 3500, max: 5000 },
    { stage: 'Ludwig I', min: 1000, max: 2000 },
    { stage: 'Ludwig II', min: 1800, max: 2800 },
    { stage: 'Ludwig III', min: 2500, max: 3500 },
  ],
  donorSupply: 'Assess donor density: >80 FU/cm² good, 60–80 moderate, <60 limited. Preserve donor — flag if demand exceeds ~50% of estimated safe donor yield.',
  redFlags: [
    'Age under 25 with aggressive/rapid loss',
    'Diffuse unpatterned thinning (possible retrograde alopecia / DUPA)',
    'Active scalp disease or inflammation',
    'Unrealistic density/coverage expectations',
    'Recent rapid shedding — stabilize medically first',
  ],
  // The surgeon's own Q&A standards, in his words. Authoritative — used to voice summaries/answers.
  faq: [] as { q: string; a: string }[],
};
export async function getRulebook() {
  const row = await prisma.hairRulebook.findUnique({ where: { id: 'default' } });
  return (row?.rules as any) ?? DEFAULT_RULES;
}
export async function saveRulebook(rules: any) {
  return prisma.hairRulebook.upsert({ where: { id: 'default' }, update: { rules }, create: { id: 'default', rules } });
}

// ---- agent core ----
const norm = (s?: string | null) => (s ?? '').toString().toLowerCase().replace(/norwood|ludwig|stage|type|class/g, '').replace(/[^a-z0-9]/g, '').trim();
const mode = (xs: string[]) => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; };

type Vision = { stage: string; pattern: string; recession: string; coverage: string; description: string; confidence: string; method: string };
function heuristicVision(sex: string, lib: { stage: string }[]): Vision {
  const common = lib.length ? mode(lib.map((c) => c.stage)) : (sex === 'female' ? 'Ludwig II' : 'Norwood III');
  return { stage: common ?? (sex === 'female' ? 'Ludwig II' : 'Norwood III'), pattern: '', recession: '', coverage: '', description: 'Photo analysis was unavailable for this upload — the stage defaulted to your most common pattern for this sex. Add clear front/top/crown photos for a photo-based read.', confidence: 'low', method: 'library-fallback' };
}

// (a) the vision model reads the photos and describes pattern / recession / coverage + a stage.
async function readPhotos(photos: Record<string, string>, sex: string, lib: { stage: string }[]): Promise<Vision> {
  const apiKey = process.env.GEMINI_API_KEY;
  const scale = sex === 'female' ? 'Ludwig' : 'Norwood';
  const order = ['front', 'top', 'crown', 'left', 'right'];
  const keys = order.map((k) => photos[k]).filter(Boolean).slice(0, 5);
  if (!apiKey || keys.length === 0) return heuristicVision(sex, lib);

  const examples = scale === 'Ludwig' ? 'Ludwig I, Ludwig II, Ludwig III' : 'Norwood II, Norwood III, Norwood III vertex, Norwood IV, Norwood V, Norwood VI, Norwood VII';
  const prompt = `You are assisting a hair-transplant surgeon by reading standardized scalp photographs (front hairline, top-down, crown, left, right) of a ${sex} patient. Describe the hair-loss objectively and estimate the ${scale} stage.
Return ONLY JSON:
{"stage":"<one of: ${examples}>",
 "pattern":"<overall pattern in a few words, e.g. 'receding hairline with vertex thinning'>",
 "recession":"<hairline/temporal recession, one short phrase>",
 "coverage":"<mid-scalp & crown coverage/density, one short phrase>",
 "description":"<1–2 plain sentences summarizing what is visible>",
 "confidence":"low|medium|high"}
Be objective and cautious. This is a PRELIMINARY read to support the surgeon — never a diagnosis, and never state precise graft numbers.`;

  const parts: any[] = [{ text: prompt }];
  for (const pk of keys) { try { const { buf, mime } = await readPhoto(pk); parts.push({ inlineData: { mimeType: mime, data: buf.toString('base64') } }); } catch { /* skip */ } }
  if (parts.length === 1) return heuristicVision(sex, lib);
  try {
    const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
    });
    const data = await res.json();
    const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const j = JSON.parse(txt.replace(/```json/gi, '').replace(/```/g, '').trim());
    if (!j?.stage) return heuristicVision(sex, lib);
    return {
      stage: String(j.stage), pattern: String(j.pattern ?? ''), recession: String(j.recession ?? ''),
      coverage: String(j.coverage ?? ''), description: String(j.description ?? ''),
      confidence: ['low', 'medium', 'high'].includes(j.confidence) ? j.confidence : 'medium', method: 'vision',
    };
  } catch { return heuristicVision(sex, lib); }
}

function ruleRangeFor(rules: any, stage: string): { min: number; max: number } | null {
  const rows = Array.isArray(rules?.graftRangePerStage) ? rules.graftRangePerStage : [];
  const hit = rows.find((r: any) => norm(r.stage) === norm(stage));
  return hit && hit.min != null ? { min: +hit.min, max: +(hit.max ?? hit.min) } : null;
}

// The full agent: vision read -> retrieve similar cases -> apply rulebook -> ranged estimate + summary.
export async function runAssessment(photos: Record<string, string>, intake: { sex: string; age?: number | null; duration?: string | null }) {
  const sex = intake.sex === 'female' ? 'female' : 'male';
  const scale = sex === 'female' ? 'Ludwig' : 'Norwood';
  const [lib, rules] = await Promise.all([prisma.hairCase.findMany({ where: { isTest: false, sex } }), getRulebook()]);

  // (a) vision
  const vision = await readPhotos(photos, sex, lib);

  // (b) retrieve the MOST SIMILAR taught cases: exact-stage first, then same sex.
  const atStage = lib.filter((c) => norm(c.stage) === norm(vision.stage));
  const pool = atStage.length ? atStage : lib;
  const reference = [...pool].sort((a, b) => (+new Date(b.createdAt)) - (+new Date(a.createdAt))).slice(0, 5);

  // (c) apply rulebook + his cases -> graft RANGE (never precise).
  const hisMins = pool.map((c) => c.graftMin).filter((n): n is number => n != null);
  const hisMaxs = pool.map((c) => c.graftMax ?? c.graftMin).filter((n): n is number => n != null);
  const hisRange = hisMins.length ? { min: Math.min(...hisMins), max: Math.max(...hisMaxs) } : null;
  const ruleRange = ruleRangeFor(rules, vision.stage);
  const range = hisRange ?? ruleRange; // his cases lead; rulebook backs up when he has none yet
  const technique = mode(pool.map((c) => c.technique).filter((t): t is string => !!t)) ?? null;

  // red-flags: surface any rulebook flags whose keywords appear in intake/vision, plus age<25.
  const hay = `${vision.pattern} ${vision.description} ${intake.duration ?? ''}`.toLowerCase();
  const flags: string[] = [];
  if (intake.age != null && intake.age < 25) flags.push(`Patient age ${intake.age} — younger patients need caution (future loss).`);
  for (const f of (rules.redFlags ?? [])) { const kw = String(f).toLowerCase(); if (/diffuse|dupa|retrograde/.test(kw) && /diffuse|unpattern|thinning all/.test(hay)) flags.push(f); }

  // (d) coverage note + plain-language summary (templated -> no false precision, no invention).
  const d = rules.densityPerZone ?? {};
  const coverageNote = `Target density (your rulebook): hairline ${d.hairline ?? '—'}, mid ${d.mid ?? '—'}, crown ${d.crown ?? '—'} grafts/cm². ${vision.coverage ? 'Observed coverage: ' + vision.coverage + '.' : ''} Donor: ${rules.donorSupply ?? '—'}`.trim();
  const rangeText = range ? `${range.min.toLocaleString()}–${range.max.toLocaleString()} grafts` : 'a graft range (add cases or set rulebook ranges to calibrate)';
  const ageBit = intake.age ? `${intake.age}-year-old ` : '';
  const summary = `Preliminary pre-consultation read for this ${ageBit}${sex} patient${intake.duration ? ` (loss ~${intake.duration})` : ''}. Photos suggest ${vision.pattern || vision.stage}${vision.recession ? `, ${vision.recession}` : ''}. Estimated ${vision.stage}. Preliminary graft estimate: ${rangeText}${technique ? `, typically ${technique} in your practice` : ''}. This is a PRELIMINARY range calibrated to ${reference.length} of your own case${reference.length !== 1 ? 's' : ''} and your rulebook — physician review required before anything is final.`;

  return {
    scale,
    stage: vision.stage,
    graftMin: range?.min ?? null,
    graftMax: range?.max ?? null,
    technique,
    coverageNote,
    summary,
    confidence: vision.confidence,
    method: vision.method,
    referenceCaseIds: reference.map((c) => c.id),
    hisRange, ruleRange,
    basedOn: pool.length,
    exactStageMatches: atStage.length,
    libraryTotal: lib.length,
    redFlags: flags,
    vision,
  };
}

// ---- capture helper: auto-sort dropped photos by angle + suggest sex/stage (NOT the agent core) ----
// Convenience for "Add case": classify each photo's camera angle and suggest a stage/sex. These are
// SUGGESTIONS the surgeon confirms — his gradings + graft numbers remain the source of truth.
const ANGLES = ['front', 'top', 'crown', 'left', 'right'];
export async function sortAndSuggest(keys: string[]) {
  const fallback = () => ({
    assignments: keys.slice(0, 5).map((k, i) => ({ key: k, angle: ANGLES[i] ?? 'front', confidence: 'low' })),
    suggestion: { sex: null as string | null, stage: null as string | null, confidence: 'low' },
    method: 'order-fallback',
  });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || keys.length === 0) return fallback();

  const prompt = `You are helping a hair-transplant surgeon sort intake photographs. You are given several scalp photos, each preceded by "Image N:". Do two things:
1) For EACH image, classify the camera angle as EXACTLY one of: "front" (frontal view showing the hairline), "top" (top-down / vertex looking straight down at the scalp), "crown" (the back vertex / crown), "left" (left-side profile), "right" (right-side profile).
2) Give ONE overall SUGGESTION for the patient: "sex" ("male" or "female") and hair-loss "stage" — Norwood scale for male (e.g. "Norwood 3"), Ludwig for female (e.g. "Ludwig 2").
Return ONLY JSON: {"photos":[{"index":0,"angle":"front","confidence":"low|medium|high"}, ...],"sex":"male|female","stage":"<stage>","confidence":"low|medium|high"}.
These are SUGGESTIONS the surgeon will confirm or override — be objective, never a diagnosis.`;

  const parts: any[] = [{ text: prompt }];
  const used: string[] = [];
  for (const k of keys.slice(0, 8)) {
    try { const { buf, mime } = await readPhoto(k); parts.push({ text: `Image ${used.length}:` }); parts.push({ inlineData: { mimeType: mime, data: buf.toString('base64') } }); used.push(k); } catch { /* skip */ }
  }
  if (used.length === 0) return fallback();

  try {
    const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
    });
    const data = await res.json();
    const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const j = JSON.parse(txt.replace(/```json/gi, '').replace(/```/g, '').trim());
    const rows: any[] = Array.isArray(j?.photos) ? j.photos : [];
    const assignments = used.map((k, i) => {
      const row = rows.find((r) => +r.index === i);
      const angle = ANGLES.includes(row?.angle) ? row.angle : ANGLES[i] ?? 'front';
      return { key: k, angle, confidence: ['low', 'medium', 'high'].includes(row?.confidence) ? row.confidence : 'low' };
    });
    const sex = j?.sex === 'female' ? 'female' : j?.sex === 'male' ? 'male' : null;
    return { assignments, suggestion: { sex, stage: j?.stage ? String(j.stage) : null, confidence: ['low', 'medium', 'high'].includes(j?.confidence) ? j.confidence : 'medium' }, method: 'vision' };
  } catch { return fallback(); }
}

// ---- FAQ voice: re-voice the assessment summary in the surgeon's own standards (post-processing;
// does NOT touch the agent core). Given the factual estimate + his Q&A, rewrite the summary in his
// voice and report which FAQ entries were applied. Falls back to the templated summary. ----
export async function voiceSummary(
  est: any,
  faq: { q: string; a: string }[],
  intake: { sex: string; age?: number | null; duration?: string | null },
): Promise<{ summary: string; appliedFaq: string[] }> {
  const clean = (faq ?? []).filter((f) => f && ((f.q ?? '').trim() || (f.a ?? '').trim())).slice(0, 25);
  const apiKey = process.env.GEMINI_API_KEY;
  if (clean.length === 0 || !apiKey) return { summary: est.summary, appliedFaq: [] };

  const facts = { sex: intake.sex, age: intake.age ?? null, duration: intake.duration ?? null, stage: est.stage, graftMin: est.graftMin, graftMax: est.graftMax, technique: est.technique, coverageNote: est.coverageNote, redFlags: est.redFlags, referenceCount: est.basedOn };
  const faqText = clean.map((f, i) => `${i + 1}. Q: ${f.q}\n   A: ${f.a}`).join('\n');
  const prompt = `You are drafting a PRELIMINARY pre-consultation summary for a hair-transplant surgeon, IN HIS OWN VOICE, applying HIS OWN STANDARDS. Reflect his exact policies and phrasing — do not give generic advice.

FACTS from this assessment (do NOT invent or change any number; keep grafts as the given range):
${JSON.stringify(facts)}

THE SURGEON'S STANDARDS / FAQ (authoritative — use his wording and policy where relevant):
${faqText}

Write a concise summary (3–6 sentences) for the patient's file that applies his standards where relevant (candidacy, donor supply, expectations for this stage, age limits, technique). Keep it PRELIMINARY, ranges only, never a diagnosis, never precise graft numbers. Then list which of his FAQ questions you actually applied.
Return ONLY JSON: {"summary":"<his-voice summary>","appliedFaq":["<exact question text of each FAQ you applied>", ...]}`;

  try {
    const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }),
    });
    const data = await res.json();
    const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const j = JSON.parse(txt.replace(/```json/gi, '').replace(/```/g, '').trim());
    return { summary: (typeof j.summary === 'string' && j.summary.trim()) ? j.summary.trim() : est.summary, appliedFaq: Array.isArray(j.appliedFaq) ? j.appliedFaq.filter((s: any) => typeof s === 'string').slice(0, 8) : [] };
  } catch { return { summary: est.summary, appliedFaq: [] }; }
}

// ---- import a case note (PDF/TXT) and pull the NON-PHOTO fields (his own record -> his judgment) ----
export async function parseNoteFields(text: string) {
  const empty = { sex: null as string | null, stage: null as string | null, graftMin: null as number | null, graftMax: null as number | null, technique: null as string | null, notes: null as string | null };
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !text.trim()) return empty;
  const prompt = `Extract structured fields from this hair-transplant CASE NOTE (the surgeon's OWN record). Use ONLY information present in the note; if a field is absent use null. Do not invent numbers.
Return ONLY JSON: {"sex":"male"|"female"|null,"stage":<e.g. "Norwood 4" or "Ludwig 2", or null>,"graftMin":<number|null>,"graftMax":<number|null>,"technique":"FUE"|"FUT"|"DHI"|null,"notes":<string|null>}.
- graftMin/graftMax: a single graft count -> set both equal; a range -> min and max. Digits only, no commas.
- notes: any other relevant clinical detail from the note, concise.

CASE NOTE:
"""
${text.slice(0, 8000)}
"""`;
  try {
    const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
    });
    const data = await res.json();
    const j = JSON.parse((data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').replace(/```json/gi, '').replace(/```/g, '').trim());
    const num = (n: any) => (n == null || n === '' || isNaN(+n) ? null : Math.round(+n));
    return {
      sex: j.sex === 'female' ? 'female' : j.sex === 'male' ? 'male' : null,
      stage: j.stage ? String(j.stage) : null,
      graftMin: num(j.graftMin), graftMax: num(j.graftMax),
      technique: ['FUE', 'FUT', 'DHI'].includes(j.technique) ? j.technique : null,
      notes: typeof j.notes === 'string' ? j.notes.slice(0, 4000) : null,
    };
  } catch { return empty; }
}
