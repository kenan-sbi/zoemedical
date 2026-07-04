// Pipeline worker: pulls OCR text -> Reader extraction -> persist with provenance.
// Run as a separate process: `npm run worker`
import { Worker } from 'bullmq';
import { connection } from '../lib/queue';
import '../lib/llm'; // side-effect: registers the LLM providers (gemini) before extraction runs
import { readDocument } from '../lib/llm/reader';
import { verifyFacts, verifierEnabled } from '../lib/llm/verifier';
import { persistFacts } from '../lib/pipeline/persist';
import { PrismaClient } from '@prisma/client';
import { extractDocumentText } from '../lib/ingest';
const prisma = new PrismaClient();

new Worker('pipeline', async (job) => {
  const { documentId } = job.data;
  const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
  await prisma.processingJob.update({ where: { documentId }, data: { stage: 'EXTRACT', status: 'RUNNING' } });

  // Resolve document text for the Reader: .txt read directly, PDF via pdf-parse, else OCR blocks.
  const { text } = await extractDocumentText(doc);

  try {
    const read = await readDocument(text);
    console.log(`[job ${documentId}] provider=${read.model} kept=${read.facts.length} dropped=${read.dropped.length} (${doc.filename})`);
    const out = await persistFacts(doc.patientId, documentId, text, read);

    // DEMOGRAPHICS (additive): record patient sex/birthYear from the document if stated and not
    // already known. First document that states it wins — never overwritten, never guessed.
    const dem = read.demographics;
    if (dem && (dem.sex || dem.birthYear)) {
      const patient = await prisma.patient.findUnique({ where: { id: doc.patientId } });
      const ident: any = (patient?.identifiers as any) ?? {};
      const merged = { ...ident };
      const birthYear = dem.birthYear ?? (dem.age ? new Date().getFullYear() - Number(dem.age) : null);
      if (dem.sex && !ident.sex) merged.sex = dem.sex;
      if (birthYear && !ident.birthYear) merged.birthYear = birthYear;
      if (merged.sex !== ident.sex || merged.birthYear !== ident.birthYear) {
        await prisma.patient.update({ where: { id: doc.patientId }, data: { identifiers: merged } });
      }
    }

    // CLINICAL DATING (additive): stamp each record's effective date with a fallback chain —
    //   (a) the fact's OWN clinical date from its sentence, exact;
    //   (b) else the DOCUMENT's date, marked approximate (effectiveApprox=true -> shown "~2017");
    //   (c) else left null ("undated").
    // Matches by verbatim sourceText — never touches persist.ts or the provenance rows.
    const docDate = parseEffective(read.documentDate);
    for (const f of read.facts) {
      const own = parseEffective((f as any).effective);
      const dt = own ?? docDate;
      if (!dt) continue;
      const approx = !own; // no own date -> we fell back to the document date
      const provs = await prisma.provenance.findMany({ where: { documentId, sourceText: f.sourceText }, select: { id: true } });
      if (provs.length) await prisma.clinicalRecord.updateMany({ where: { provenanceId: { in: provs.map((p) => p.id) } }, data: { effective: dt, effectiveApprox: approx } });
    }

    // VERIFY stage (additive): a different model cross-checks each fact against its source.
    // Records the outcome on Provenance.verifier; disagreements are flagged NEEDS_REVIEW.
    // Never touches persist.ts — updates provenance/records by the verbatim sourceText.
    if (verifierEnabled() && read.facts.length > 0) {
      await prisma.processingJob.update({ where: { documentId }, data: { stage: 'VERIFY' } });
      const verdicts = await verifyFacts(read.facts);
      for (const v of verdicts) {
        await prisma.provenance.updateMany({
          where: { documentId, sourceText: v.sourceText },
          data: { verifier: v.agree ? 'agree' : 'disagree' },
        });
        if (!v.agree) {
          const provs = await prisma.provenance.findMany({
            where: { documentId, sourceText: v.sourceText }, select: { id: true },
          });
          await prisma.clinicalRecord.updateMany({
            where: { provenanceId: { in: provs.map((p) => p.id) } },
            data: { status: 'NEEDS_REVIEW' },
          });
        }
      }
    }

    await prisma.processingJob.update({ where: { documentId }, data: { stage: 'DONE', status: 'DONE' } });
    return out;
  } catch (err: any) {
    // Mark the job FAILED so the UI can show it, then rethrow to let BullMQ retry/backoff.
    await prisma.processingJob.update({
      where: { documentId },
      data: { stage: 'FAILED', status: 'FAILED', error: String(err?.message ?? err) },
    });
    throw err;
  }
}, { connection, concurrency: 3 });

// Parse an extracted clinical date string (YYYY | YYYY-MM | YYYY-MM-DD) into a UTC Date.
// Returns null for anything unparseable or out of a sane range — never fabricates a date.
function parseEffective(s: unknown): Date | null {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^((?:19|20)\d{2})(?:-(0[1-9]|1[0-2]))?(?:-(0[1-9]|[12]\d|3[01]))?$/);
  if (!m) return null;
  const y = +m[1], mo = m[2] ? +m[2] - 1 : 0, d = m[3] ? +m[3] : 1;
  if (y < 1900 || y > 2100) return null;
  return new Date(Date.UTC(y, mo, d));
}

console.log('extract worker up');
