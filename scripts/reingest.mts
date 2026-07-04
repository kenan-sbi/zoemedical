// Re-ingest a patient's documents onto a FRESH patient, so the pipeline re-extracts them with the
// current Reader prompt — leaving the original patient untouched for side-by-side comparison.
//
//   tsx --env-file=.env scripts/reingest.mts <sourcePatientId> ["New patient name"]
//
// The stored files are content-addressed and already on disk (uploads/<hash>__<name>), so we reuse
// the same storageKey — no file copy. A new Document + ProcessingJob is created per source doc under
// the new patient and enqueued; the worker does the rest. Nothing on the source patient is mutated.
import { prisma } from '../lib/db';
import { enqueueDocument } from '../lib/queue';

async function main() {
  const sourceId = process.argv[2];
  if (!sourceId) { console.error('usage: reingest.mts <sourcePatientId> ["New name"]'); process.exit(1); }

  const source = await prisma.patient.findUnique({ where: { id: sourceId } });
  if (!source) { console.error(`patient not found: ${sourceId}`); process.exit(1); }

  const docs = await prisma.document.findMany({ where: { patientId: sourceId }, orderBy: { createdAt: 'asc' } });
  if (docs.length === 0) { console.error(`patient ${sourceId} has no documents`); process.exit(1); }

  const name = process.argv[3] ?? `${source.displayName} (re-ingest ${new Date().toISOString().slice(0, 16).replace('T', ' ')})`;
  const fresh = await prisma.patient.create({
    // carry over demographics (sex/birthYear) so the summary has age/sex without re-deriving
    data: { displayName: name, dob: source.dob, identifiers: source.identifiers ?? undefined },
  });
  console.log(`\nSource : ${source.displayName}  (${sourceId})`);
  console.log(`Fresh  : ${fresh.displayName}  (${fresh.id})`);
  console.log(`Copying ${docs.length} document(s):\n`);

  for (const d of docs) {
    const copy = await prisma.document.create({
      data: {
        patientId: fresh.id,
        filename: d.filename,
        mimeType: d.mimeType,
        storageKey: d.storageKey, // same on-disk file (content-addressed) — read-only reuse
        hash: d.hash,
      },
    });
    await prisma.processingJob.create({ data: { documentId: copy.id } });
    await enqueueDocument(copy.id);
    console.log(`  ✓ ${d.filename}  ->  doc ${copy.id}  (enqueued)`);
  }

  console.log(`\nEnqueued ${docs.length} document(s). Watch the worker log for [job …] provider=… kept=… dropped=….`);
  console.log(`Open the workspace, pick patient "${fresh.displayName}", and verify. Source patient is unchanged.\n`);
  await prisma.$disconnect();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
