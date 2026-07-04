import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// Live status for one uploaded document (polled by the bulk-upload list).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const doc = await prisma.document.findUnique({ where: { id: params.id }, select: { patientId: true } });
  if (!doc) return NextResponse.json({ error: 'document not found' }, { status: 404 });

  const job = await prisma.processingJob.findUnique({
    where: { documentId: params.id },
    select: { stage: true, status: true, error: true },
  });
  // Records produced from THIS document (provenance carries the documentId).
  const recordCount = await prisma.clinicalRecord.count({ where: { provenance: { documentId: params.id } } });

  return NextResponse.json({
    patientId: doc.patientId,
    stage: job?.stage ?? null,
    status: job?.status ?? null,
    error: job?.error ?? null,
    recordCount,
  });
}
