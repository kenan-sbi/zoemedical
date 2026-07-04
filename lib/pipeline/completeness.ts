// COMPLETENESS — deterministic scoring of a Case against a procedure template.
// "Is this patient's record ready?" Each template item is classified:
//   present-valid | stale | missing | referenced-not-uploaded
// Uses the Case / CompletenessTemplate models already in the schema. No LLM involved.
import { prisma } from '../db';

type Item = { key: string; label: string; required: boolean; recencyDays?: number | null; types?: string[]; keywords?: string[] };

// Built-in default template, used when the case has no procedure-specific template in the DB.
export const DEFAULT_TEMPLATE: { procedure: string; items: Item[] } = {
  procedure: 'default',
  items: [
    { key: 'diagnosis', label: 'Primary diagnosis / problem', required: true, types: ['CONDITION'] },
    { key: 'medications', label: 'Current medications', required: true, types: ['MEDICATION'] },
    { key: 'labs', label: 'Recent labs / observations', required: true, recencyDays: 90, types: ['OBSERVATION'] },
    { key: 'allergies', label: 'Allergy status', required: true, types: ['ALLERGY'] },
    { key: 'procedures', label: 'Procedures / plan', required: false, types: ['PROCEDURE'] },
  ],
};

type Status = 'present-valid' | 'stale' | 'missing' | 'referenced-not-uploaded';

export async function scoreCase(caseId: string) {
  const kase = await prisma.case.findUnique({ where: { id: caseId } });
  if (!kase) throw new Error('case not found');

  const records = await prisma.clinicalRecord.findMany({
    where: { patientId: kase.patientId },
    select: { type: true, coding: true, effective: true, negated: true },
  });

  // Prefer a physician-authored template for this procedure; else the built-in default.
  let items = DEFAULT_TEMPLATE.items;
  if (kase.procedure) {
    const tmpl = await prisma.completenessTemplate.findUnique({ where: { procedure: kase.procedure } });
    if (tmpl && Array.isArray(tmpl.items)) items = tmpl.items as unknown as Item[];
  }

  const now = Date.now();
  const assessment = items.map((item) => {
    const matches = records.filter((r) => {
      const byType = item.types?.includes(r.type as string);
      const label = ((r.coding as any)?.display ?? '').toLowerCase();
      const byKw = item.keywords?.some((k) => label.includes(k.toLowerCase()));
      return byType || byKw;
    });

    let status: Status;
    if (matches.length === 0) {
      status = 'missing';
    } else if (item.recencyDays) {
      const dated = matches.filter((m) => m.effective);
      // If we have dates and every one is older than the window → stale. Undated → treat as valid
      // (TODO: infer effective date from the document / provenance to make recency real).
      const fresh = dated.some((m) => now - new Date(m.effective as any).getTime() <= item.recencyDays! * 86400000);
      status = dated.length > 0 && !fresh ? 'stale' : 'present-valid';
    } else {
      status = 'present-valid';
    }
    // TODO(referenced-not-uploaded): detect "see attached / prior report" mentions in source text
    // and mark items that are referenced but whose document was never uploaded.
    return { key: item.key, label: item.label, required: item.required, status, matchCount: matches.length };
  });

  const required = assessment.filter((a) => a.required);
  const satisfied = required.filter((a) => a.status === 'present-valid').length;
  const score = required.length ? Math.round((satisfied / required.length) * 100) : 100;

  const updated = await prisma.case.update({
    where: { id: caseId },
    data: { score, assessment: assessment as any },
  });
  return { score: updated.score, procedure: kase.procedure ?? 'default', assessment };
}
