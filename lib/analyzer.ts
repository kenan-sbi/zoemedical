// Analyzer helpers for the chat rail. The ANALYZER role answers questions and drafts
// deliverables STRICTLY from a case's already-extracted records — it never invents facts.
// (Extraction/provenance live in reader.ts/persist.ts and are not touched here.)

export const ANALYZER_SYSTEM = `You are a clinical analysis assistant working over ONE patient's already-extracted records.
Input is a JSON object: { patient, question, records }. Each record has an "id" and the verbatim "source" text it was extracted from.

STRICT RULES:
- Use ONLY facts present in the provided records. Never invent or assume clinical facts, values, dates, drugs, or names.
- If the records do not support an answer or a requested document, say so plainly — do not fabricate to fill gaps.
- Track which record ids you actually relied on.

Choose a mode:
- "generate": the user asks you to draft/write/produce a document (e.g. insurance letter, referral summary, discharge note).
- "answer": any other question about the case.

Return ONLY a JSON object, no markdown fences:
{
  "mode": "answer" | "generate",
  "answer": string,            // mode=answer: your prose answer. mode=generate: a one-line note (e.g. "Drafted the insurance letter.")
  "title": string,             // mode=generate: the deliverable title. mode=answer: ""
  "body": string,              // mode=generate: the full deliverable as plain text with \n line breaks. mode=answer: ""
  "sourceRecordIds": string[]  // ids of the records you actually used
}`;

export interface AnalyzerResult {
  mode: 'answer' | 'generate';
  answer: string;
  title: string;
  body: string;
  sourceRecordIds: string[];
}

// Compact the case records into the context the analyzer is allowed to use.
export function buildContext(patientName: string | undefined, question: string, records: any[]) {
  const facts = records.map((r) => ({
    id: r.id,
    type: r.type,
    display: (r.coding as any)?.display ?? null,
    payload: r.payload,
    negated: r.negated,
    assertion: r.assertion,
    status: r.status,
    source: r.provenance?.sourceText ?? null,
  }));
  return JSON.stringify({ patient: { name: patientName ?? null }, question, records: facts });
}

export function parseAnalyzer(raw: string, allowedIds: string[]): AnalyzerResult {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  let obj: any = {};
  try { obj = JSON.parse(cleaned); }
  catch { const m = cleaned.match(/\{[\s\S]*\}/); if (m) { try { obj = JSON.parse(m[0]); } catch {} } }

  const mode = obj?.mode === 'generate' ? 'generate' : 'answer';
  const allow = new Set(allowedIds);
  const ids = Array.isArray(obj?.sourceRecordIds) ? obj.sourceRecordIds.filter((id: any) => allow.has(id)) : [];
  return {
    mode,
    answer: typeof obj?.answer === 'string' ? obj.answer : (mode === 'answer' ? cleaned : ''),
    title: typeof obj?.title === 'string' ? obj.title : '',
    body: typeof obj?.body === 'string' ? obj.body : '',
    sourceRecordIds: ids,
  };
}
