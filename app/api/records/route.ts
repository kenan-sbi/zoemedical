import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Read the extracted ClinicalRecords for a patient, each with its mandatory Provenance.
// Polled by the UI to show the loop's output.
// TODO(auth): gate behind getSessionUser/requireRole once the sign-in flow lands.
export async function GET(req: NextRequest) {
  const patientId = req.nextUrl.searchParams.get('patientId');
  if (!patientId) return NextResponse.json({ error: 'patientId required' }, { status: 400 });

  const [records, job] = await Promise.all([
    prisma.clinicalRecord.findMany({
      where: { patientId },
      include: { provenance: true },
      orderBy: { createdAt: 'asc' },
    }),
    // surface latest processing status so the UI can say "still extracting…"
    prisma.processingJob.findFirst({
      where: { document: { patientId } },
      orderBy: { updatedAt: 'desc' },
      select: { stage: true, status: true, error: true },
    }),
  ]);

  return NextResponse.json({ records, job });
}
