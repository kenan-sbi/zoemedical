// PERSIST — enforces the core rule: no ClinicalRecord without Provenance.
import { PrismaClient } from '@prisma/client';
import type { ReadResult } from '../llm/reader';
import { locateSpan } from '../llm/reader';
const prisma = new PrismaClient();

export async function persistFacts(patientId: string, documentId: string, documentText: string, read: ReadResult) {
  const ids: string[] = [];
  for (const f of read.facts) {
    const span = locateSpan(f.sourceText, documentText);
    const prov = await prisma.provenance.create({
      data: { documentId, sourceText: f.sourceText, model: read.model, spanStart: span?.spanStart, spanEnd: span?.spanEnd },
    });
    // Store the coded concept for cross-document/cross-language resolution. `label` keeps the
    // original source-language term; `display` is the canonical English concept (falls back to label).
    const coding = f.coding
      ? { ...f.coding, display: f.coding.display ?? f.display, label: f.display }
      : { display: f.display, label: f.display };
    const rec = await prisma.clinicalRecord.create({
      data: {
        patientId, type: f.type as any, payload: f.payload, negated: f.negated, assertion: f.assertion as any,
        confidence: f.confidence, status: f.needsReview ? 'NEEDS_REVIEW' : 'EXTRACTED',
        coding, provenanceId: prov.id,
      },
    });
    ids.push(rec.id);
  }
  return { persisted: ids.length, dropped: read.dropped.length };
}
