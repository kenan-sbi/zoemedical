import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { storeUpload } from '@/lib/ingest';

// Each file's extraction runs inline via waitUntil on Vercel — give the function room.
export const runtime = 'nodejs';
export const maxDuration = 60;

// Bulk upload: attaches EVERY dropped file to ONE selected patient (Patient has many Documents).
// A patientId is REQUIRED — we never auto-create a patient per file (that scattered one patient's
// documents across many records). The caller selects/creates the patient first.
export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData();
  const files = form.getAll('file').filter((f): f is File => f instanceof File);
  const patientId = (form.get('patientId') as string) || null;
  if (files.length === 0) return NextResponse.json({ error: 'no files' }, { status: 400 });
  if (!patientId) return NextResponse.json({ error: 'patientId required — select or create a patient first' }, { status: 400 });

  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) return NextResponse.json({ error: 'patient not found' }, { status: 404 });

  // Never ingest test answer keys as patient documents (e.g. 00_JOURNEY_KEY.pdf, 00_JOURNEY10_KEY.pdf,
  // ANSWER_KEY.pdf). Matches "journey"/"answer" + optional chars + "key".
  const isKey = (name: string) => /(journey|answer)\w*[ _-]?key/i.test(name) || /_key\.[a-z0-9]+$/i.test(name);

  const uploads: { documentId: string; patientId: string; filename: string; patientName: string }[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    if (isKey(file.name)) { skipped.push(file.name); continue; }
    const buf = Buffer.from(await file.arrayBuffer());
    const documentId = await storeUpload(buf, file.name, file.type || 'application/pdf', patientId);
    await prisma.auditLog.create({ data: { userId: user.id, action: 'UPLOAD', resource: documentId } });
    uploads.push({ documentId, patientId, filename: file.name, patientName: patient.displayName });
  }

  return NextResponse.json({ uploads, skipped });
}
