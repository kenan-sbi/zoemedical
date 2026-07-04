// READER — the heart of the MVP.
// Extracts clinical facts from document text. The contract that makes it SOLID and not a toy:
//   1. Every extracted fact MUST quote the exact source text it came from (provenance).
//   2. Anything without a verbatim source quote that appears in the document is DROPPED.
//   3. Negation ("no evidence of X") is captured explicitly — never silently flipped.
//   4. Low confidence -> flagged NEEDS_REVIEW, never silently trusted.
// The model proposes; this code enforces. That enforcement is the safety layer.

import { z } from 'zod';
import { getProvider, MODEL_ROUTING } from './provider';

export const ExtractedFact = z.object({
  type: z.enum(['OBSERVATION', 'CONDITION', 'MEDICATION', 'PROCEDURE', 'ALLERGY', 'IMMUNIZATION']),
  display: z.string(),                 // human label, e.g. "Serum creatinine"
  payload: z.record(z.any()),          // {value, unit, referenceRange, flag} | {drug, dose, route} ...
  assertion: z.enum(['CONFIRMED','SUSPECTED','HISTORICAL','RULED_OUT','FAMILY_HISTORY']).default('CONFIRMED'),
  negated: z.boolean().default(false),
  sourceText: z.string().min(3),       // MUST be a verbatim quote from the document
  confidence: z.number().min(0).max(1),
  // Clinical effective date the fact pertains to, read FROM the source (YYYY | YYYY-MM | YYYY-MM-DD).
  // Null when the source states no date. This is the event's real date — NOT the upload date.
  effective: z.string().nullish(),
  // Coded concept for CROSS-DOCUMENT / CROSS-LANGUAGE resolution. `display` is the canonical
  // ENGLISH concept name (so Turkish/Arabic/English mentions of the same thing share a key);
  // laterality/bodySite keep genuinely different entities (left vs right) apart.
  coding: z.object({
    system: z.string().nullish(),      // "ICD10" | "SNOMED" | "RXNORM" | "ATC" ...
    code: z.string().nullish(),
    display: z.string().nullish(),     // canonical English concept name
    laterality: z.enum(['left', 'right', 'bilateral']).nullish(),
    bodySite: z.string().nullish(),
  }).nullish(),
});
export type ExtractedFact = z.infer<typeof ExtractedFact>;

const SYSTEM = `You are a clinical data extractor. Extract ONLY facts explicitly stated in the document.
Rules you must follow exactly:
- For every fact, "sourceText" MUST be an exact verbatim substring copied from the document. Do not paraphrase it.
- Prefer the CLINICAL SENTENCE that actually asserts the fact (e.g. "Diagnosed with type 2 diabetes in 2018") — NOT a letterhead, facility name, header, address, or unrelated line.
- For MEDICATION facts, set payload.status to "started" | "stopped" | "ongoing" | "changed" based on what the source says, in ANY language (Turkish "başlandı"/Arabic "بدء" = started; "durduruldu"/"إيقاف" = stopped). This must be correct regardless of source language.
- MEDICATION means a drug the patient IS taking. NEVER create a MEDICATION from a negated, absent, hypothetical, or cautionary statement. "takes no medications that lower the seizure threshold", "not on anticoagulation", "avoid NSAIDs", "no current medications" are NOT medications — either skip them or, if a specific drug is named as absent, emit it as a MEDICATION with negated=true (it will be treated as not-taken), never as an active drug. Do NOT invent a drug named after a drug CLASS or effect (e.g. "Medications lowering seizure threshold" is not a drug).
- "allergic to X" / "allergy to X" / "reaction to X" is an ALLERGY (type=ALLERGY, coding.display=the substance), NOT a MEDICATION. A drug the patient reacts to must never appear as an active medication.
- For MEDICATION coding.display, use the SPECIFIC active ingredient (generic name), NOT a drug class or effect. Prefer "Levetiracetam" over "anticonvulsant", "Prednisolone" over "corticosteroid"/"corticosteroid therapy", "Mycophenolate" over "immunosuppressant". If ONLY a class is stated with no named drug, you may use the class — but if the named drug appears anywhere, always code the named drug. Drop the word "therapy" from the drug name.
- Never infer or add a value that is not written in the document.
- If a finding is negated ("no evidence of", "denies", "ruled out"), set negated=true and capture it — do NOT drop the "no".
- Set assertion to HISTORICAL for past history, FAMILY_HISTORY for family history, SUSPECTED for "query"/"?"/"possible".
- confidence is your certainty the extraction is correct (0..1). Be honest; low confidence is expected on messy text.
- "effective": the CLINICAL date this fact pertains to, read from the source text (e.g. "since 2018" -> "2018", "in March 2022" -> "2022-03", "on 2023-05-14" -> "2023-05-14"). Use YYYY, YYYY-MM, or YYYY-MM-DD. This is the date the event happened, NOT today's date. If the source states no date for this fact, set it to null. Never invent a date.
- "coding": ground each concept in a STANDARD MEDICAL ONTOLOGY so the SAME entity across documents/
  languages/synonyms resolves to ONE record via its code. This coding is what deduplicates facts.
    - "display": the canonical ENGLISH concept name — TRANSLATE from the source language (Turkish "invaziv duktal karsinom" and Arabic "سرطان الثدي الغازي" both -> "invasive ductal carcinoma"; "Tamoksifen" -> "Tamoxifen").
    - "system"+"code": the standard code, from your own medical knowledge, ONLY when you are confident:
        · CONDITION  -> SNOMED CT (system:"SNOMED") preferred, else ICD-10 (system:"ICD10").
        · MEDICATION -> RxNorm at the INGREDIENT level (system:"RXNORM", code = the ingredient RxCUI).
            Resolve DRUG CLASS -> the specific named ingredient; BRAND -> its generic ingredient;
            SALT/ESTER/combo -> the base ingredient. So "co-trimoxazole", "trimethoprim-sulfamethoxazole"
            and "Bactrim" all carry the SAME RxNorm ingredient code; "corticosteroid" + "Prednisolone"
            both code to prednisolone's ingredient code. coding.display = the ingredient (generic) name.
        · OBSERVATION that is a LAB -> LOINC (system:"LOINC", code = the LOINC code); coding.display = the standard analyte name.
      If you are NOT confident of the exact code, set BOTH system and code to null and keep the concept
      as text (display only) — NEVER guess or fabricate a code. A wrong code is worse than no code.
    - "laterality": "left" | "right" | "bilateral" for sided findings; else null. Left vs right are DIFFERENT entities.
    - "bodySite": the anatomical site when relevant; else null.
  The top-level "display" field stays in the ORIGINAL source language (for provenance); "coding.display" is the English canonical. Coding never changes what was said — the sourceText quote is still mandatory (cite-or-drop).

Output schema — each fact is a JSON object with EXACTLY these fields:
  "type": one of "OBSERVATION" | "CONDITION" | "MEDICATION" | "PROCEDURE" | "ALLERGY" | "IMMUNIZATION"
     (labs/vitals/measurements -> OBSERVATION; diagnoses/problems/SYMPTOMS -> CONDITION;
      drugs/prescriptions -> MEDICATION; operations/interventions -> PROCEDURE;
      allergies -> ALLERGY; vaccines -> IMMUNIZATION)
     A SYMPTOM (fever, headache, seizure, low mood) is a CONDITION, NOT an OBSERVATION. A named
     disease (hypertension, diabetes) is a CONDITION, NOT an OBSERVATION. Reserve OBSERVATION for a
     measured/observed data point (a lab result, a vital sign, an imaging finding, an exam finding).
  "display": short human label, e.g. "Serum creatinine"
  "payload": object with the details, e.g. {"value","unit","referenceRange","flag","category"} for OBSERVATION,
     {"drug","dose","route","frequency"} for MEDICATION, {"name"} otherwise.
     For OBSERVATION, ALWAYS set payload.category to exactly one of: "laboratory" (a blood/urine/serology/
     CSF test with a numeric value+unit, e.g. creatinine, anti-dsDNA, complement C3), "vital" (blood
     pressure, heart rate, temperature, weight), "imaging" (MRI/CT/X-ray/ultrasound findings, e.g.
     "white matter hyperintensity"), or "exam" (physical/cognitive exam findings, e.g. "attention deficit",
     "normal memory"). This drives which tab the observation appears in — only "laboratory" goes to Labs.
     For lab tests, "coding.display" MUST be the STANDARD analyte name so the same test across dates
     merges into ONE trend (e.g. always "Anti-dsDNA antibody" — never both "DNA (ds) Ab" and
     "Anti-double stranded DNA antibody measurement"; always "Complement C3", "Complement C4", "Creatinine").
  "assertion": one of "CONFIRMED" | "SUSPECTED" | "HISTORICAL" | "RULED_OUT" | "FAMILY_HISTORY"
  "negated": boolean
  "sourceText": the exact verbatim substring from the document
  "confidence": number 0..1
  "effective": "YYYY" | "YYYY-MM" | "YYYY-MM-DD" read from the source, or null if no date is stated
  "coding": { "system": string|null, "code": string|null, "display": canonical-English-name, "laterality": "left"|"right"|"bilateral"|null, "bodySite": string|null }
Use ONLY these enum values verbatim.

Return ONLY a JSON OBJECT: {"facts": [ one object per fact as specified above ], "demographics": {"sex": "male"|"female"|null, "birthYear": <4-digit year>|null, "age": <number>|null}, "documentDate": {"value": "YYYY-MM-DD"|"YYYY-MM"|"YYYY"|null, "sourceText": <verbatim quote of that date or null>}}.
Fill "demographics" ONLY from what the document explicitly states: "sex"; "birthYear" if a birth date/year is given; "age" if an age is stated (e.g. "58-year-old" -> 58). Otherwise null. Never guess.
"documentDate": the date THIS document was authored (the report/letter/clinic-visit/admission/discharge date shown on it, usually near the top or signature). Put the canonical date in "value" and the EXACT verbatim quote of that date in "sourceText". This is used as an approximate fallback date for facts that state no date of their own. If the document shows no date, set both to null. Never guess.
No prose, no markdown fences.`;

const CONFIDENCE_REVIEW_THRESHOLD = 0.75;

export interface Demographics { sex?: 'male' | 'female' | null; birthYear?: number | null; age?: number | null }
export interface ReadResult {
  facts: (ExtractedFact & { needsReview: boolean })[];
  dropped: { reason: string; raw: unknown }[];  // audit trail of what we refused to trust
  model: string;
  demographics: Demographics | null;
  // The document's own date (canonical YYYY|YYYY-MM|YYYY-MM-DD), cited to source — used as an
  // APPROXIMATE fallback for facts that state no date. Null unless the document shows a date.
  documentDate: string | null;
}

// Enforces the contract on the model output. documentText is the OCR'd source.
export async function readDocument(documentText: string): Promise<ReadResult> {
  const routing = MODEL_ROUTING.READER;
  const provider = getProvider(routing.provider);

  const raw = await provider.complete({
    system: SYSTEM,
    user: documentText,
    reasoning: routing.reasoning,
    temperature: routing.temperature,
  });

  const { facts: parsed, demographics, documentDate: ddRaw } = safeParse(raw);
  const facts: ReadResult['facts'] = [];
  const dropped: ReadResult['dropped'] = [];

  // Document date is CITE-OR-DROP too: only trust it if its quoted source actually appears in the
  // document. This keeps the approximate fallback grounded in real text, never invented.
  const documentDate = ddRaw && ddRaw.value && ddRaw.sourceText && sourceAppearsInDocument(ddRaw.sourceText, documentText)
    ? normalizeDate(ddRaw.value)
    : null;

  for (const item of parsed) {
    const check = ExtractedFact.safeParse(item);
    if (!check.success) { dropped.push({ reason: 'schema-invalid', raw: item }); continue; }
    const fact = check.data;

    // CONTRACT ENFORCEMENT: the cited source must actually appear in the document.
    // This is what stops a confident hallucination from becoming a stored fact.
    if (!sourceAppearsInDocument(fact.sourceText, documentText)) {
      dropped.push({ reason: 'citation-not-found-in-source', raw: item });
      continue;
    }
    // Normalize the extracted clinical date into a canonical form (YYYY | YYYY-MM | YYYY-MM-DD),
    // robust to the many ways real notes state dates. Never fabricates one — null stays null.
    facts.push({ ...fact, effective: normalizeDate(fact.effective), needsReview: fact.confidence < CONFIDENCE_REVIEW_THRESHOLD || fact.negated });
  }

  return { facts, dropped, model: `${provider.name}`, demographics, documentDate };
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');

// Canonicalize a stated clinical date to YYYY | YYYY-MM | YYYY-MM-DD, or null if none.
// Handles: "2022", "since 2018", "in 2023", "2022-03", "2022/03/14", "Mar 2022", "March 2022",
// "May 14, 2023", "14 Mar 2024", and dates embedded mid-sentence. Does NOT guess when absent.
export function normalizeDate(input?: string | null): string | null {
  if (!input) return null;
  const s = String(input).toLowerCase();
  const mon = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
  let m: RegExpMatchArray | null;
  if ((m = s.match(/\b((?:19|20)\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/))) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  if ((m = s.match(/\b((?:19|20)\d{2})[-/](0?[1-9]|1[0-2])\b/))) return `${m[1]}-${pad(+m[2])}`;
  if ((m = s.match(new RegExp(`\\b${mon}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+((?:19|20)\\d{2})\\b`)))) return `${m[3]}-${pad(MONTHS[m[1].slice(0, 3)])}-${pad(+m[2])}`;
  if ((m = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${mon}\\.?\\s+((?:19|20)\\d{2})\\b`)))) return `${m[3]}-${pad(MONTHS[m[2].slice(0, 3)])}-${pad(+m[1])}`;
  if ((m = s.match(new RegExp(`\\b${mon}\\.?\\s+((?:19|20)\\d{2})\\b`)))) return `${m[2]}-${pad(MONTHS[m[1].slice(0, 3)])}`;
  if ((m = s.match(/\b((?:19|20)\d{2})\b/))) return m[1]; // bare year (covers "since 2018", "in 2023")
  return null;
}

// locate the span so we can store page/offsets as provenance
export function locateSpan(sourceText: string, documentText: string) {
  const idx = normalize(documentText).indexOf(normalize(sourceText));
  return idx < 0 ? null : { spanStart: idx, spanEnd: idx + sourceText.length };
}

function sourceAppearsInDocument(src: string, doc: string) {
  return normalize(doc).includes(normalize(src));
}
function normalize(s: string) { return s.replace(/\s+/g, ' ').trim().toLowerCase(); }

// Accepts the new {facts, demographics, documentDate} object OR a bare array of facts (legacy / mock).
type DocDate = { value?: string | null; sourceText?: string | null } | null;
function safeParse(raw: string): { facts: unknown[]; demographics: Demographics | null; documentDate: DocDate } {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  let v: any;
  try { v = JSON.parse(cleaned); }
  catch { const m = cleaned.match(/[\[{][\s\S]*[\]}]/); if (m) { try { v = JSON.parse(m[0]); } catch {} } }
  if (Array.isArray(v)) return { facts: v, demographics: null, documentDate: null };
  if (v && typeof v === 'object') {
    const d = v.demographics && typeof v.demographics === 'object' ? v.demographics : null;
    const dd = v.documentDate && typeof v.documentDate === 'object' ? v.documentDate : null;
    return { facts: Array.isArray(v.facts) ? v.facts : [], demographics: d, documentDate: dd };
  }
  return { facts: [], demographics: null, documentDate: null };
}
