// Shared helpers for the review-and-sign slice. Does NOT modify extraction or provenance.
import { prisma } from './db';

export const ASSERTIONS = ['CONFIRMED', 'SUSPECTED', 'HISTORICAL', 'RULED_OUT', 'FAMILY_HISTORY'] as const;

// Get-or-create the single case for a patient (MVP: one active case per patient).
export async function caseForPatient(patientId: string) {
  const existing = await prisma.case.findFirst({
    where: { patientId },
    orderBy: { createdAt: 'asc' },
    include: { signOff: true },
  });
  if (existing) return existing;
  return prisma.case.create({ data: { patientId }, include: { signOff: true } });
}

// Load a record together with its patient's case, so callers can check the lock.
export async function loadRecordWithCase(recordId: string) {
  const record = await prisma.clinicalRecord.findUnique({ where: { id: recordId } });
  if (!record) return { record: null, kase: null };
  const kase = await prisma.case.findFirst({
    where: { patientId: record.patientId },
    include: { signOff: true },
  });
  return { record, kase };
}
