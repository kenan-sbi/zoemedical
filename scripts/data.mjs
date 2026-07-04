// Data admin for local dev. Run with env loaded:
//   node --env-file=.env scripts/data.mjs list
//   node --env-file=.env scripts/data.mjs wipe                      # delete ALL patient data (keeps Users)
//   node --env-file=.env scripts/data.mjs merge <targetId> <srcId...>  # move src patients' docs+records into target
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const [cmd, ...args] = process.argv.slice(2);

async function list() {
  const patients = await prisma.patient.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { documents: true, records: true } } } });
  if (patients.length === 0) { console.log('(no patients)'); return; }
  for (const p of patients) {
    console.log(`\n${p.displayName}  [${p.id}]`);
    console.log(`  docs=${p._count.documents}  records=${p._count.records}`);
    const docs = await prisma.document.findMany({ where: { patientId: p.id }, select: { id: true, filename: true, mimeType: true } });
    for (const d of docs) console.log(`    · ${d.filename} (${d.mimeType}) [${d.id}]`);
  }
  const totals = await prisma.patient.count();
  console.log(`\nTOTAL patients=${totals}, documents=${await prisma.document.count()}, records=${await prisma.clinicalRecord.count()}`);
}

async function wipe() {
  // FK-safe order. Users are preserved.
  await prisma.clinicalRecord.deleteMany();
  await prisma.provenance.deleteMany();
  await prisma.review.deleteMany();
  await prisma.signOff.deleteMany();
  await prisma.case.deleteMany();
  await prisma.processingJob.deleteMany();
  await prisma.document.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.patient.deleteMany();
  console.log('Wiped all patient data (Users kept). Note: files under ./uploads are left on disk (harmless; content-addressed).');
}

async function merge() {
  const [target, ...sources] = args;
  if (!target || sources.length === 0) { console.log('usage: merge <targetId> <srcId...>'); return; }
  const t = await prisma.patient.findUnique({ where: { id: target } });
  if (!t) { console.log(`target ${target} not found`); return; }
  for (const src of sources) {
    if (src === target) continue;
    const cases = await prisma.case.findMany({ where: { patientId: src }, select: { id: true } });
    const caseIds = cases.map((c) => c.id);
    await prisma.review.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.signOff.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.case.deleteMany({ where: { patientId: src } });
    // Move documents + records to the target patient. Provenance.documentId is unchanged, so
    // every fact still traces to its original document.
    const d = await prisma.document.updateMany({ where: { patientId: src }, data: { patientId: target } });
    const r = await prisma.clinicalRecord.updateMany({ where: { patientId: src }, data: { patientId: target } });
    await prisma.patient.delete({ where: { id: src } });
    console.log(`merged ${src} -> ${target}: moved ${d.count} docs, ${r.count} records`);
  }
}

const fn = { list, wipe, merge }[cmd];
if (!fn) { console.log('commands: list | wipe | merge <targetId> <srcId...>'); process.exit(1); }
await fn();
await prisma.$disconnect();
