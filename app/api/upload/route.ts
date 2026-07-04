import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, DEV_USER } from '@/lib/auth';
import { dispatchDocument } from '@/lib/dispatch';
import { putObject } from '@/lib/storage';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const user = await getSessionUser(token);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file') as File;
  const patientId = form.get('patientId') as string;
  if (!file || !patientId) return NextResponse.json({ error: 'file + patientId required' }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const hash = createHash('sha256').update(buf).digest('hex');

  // Persist the file to object storage (Supabase Storage on Vercel, local disk in dev).
  const safeName = file.name.replace(/[^\w.\-]/g, '_');
  const storageKey = `uploads/${hash}__${safeName}`;
  await putObject(storageKey, buf, file.type);

  // DEV: seed the bypass user so the AuditLog FK resolves. No-op once real auth is on.
  if (process.env.DEV_NO_AUTH === '1' && user.id === DEV_USER.id) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {},
      create: { id: user.id, email: user.email, role: 'OWNER' },
    });
  }

  const doc = await prisma.document.create({
    data: { patientId, filename: file.name, mimeType: file.type, storageKey, hash },
  });
  await prisma.processingJob.create({ data: { documentId: doc.id } });
  await prisma.auditLog.create({ data: { userId: user.id, action: 'UPLOAD', resource: doc.id } });
  await dispatchDocument(doc.id);
  return NextResponse.json({ documentId: doc.id, status: 'queued' });
}
