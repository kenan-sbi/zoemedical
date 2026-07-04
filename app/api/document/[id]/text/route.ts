import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getObject } from '@/lib/storage';

// Original source text for a document (the Documents tab).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const doc = await prisma.document.findUnique({ where: { id: params.id } });
  if (!doc) return NextResponse.json({ error: 'document not found' }, { status: 404 });

  const isTxt = doc.mimeType === 'text/plain' || doc.filename.toLowerCase().endsWith('.txt');
  // TODO(i18n): expose a translated view alongside this original text in a later slice.
  if (!isTxt || !doc.storageKey) {
    return NextResponse.json({ text: null, note: 'Non-text document — OCR/original render coming in a later slice.' });
  }
  try {
    const raw = (await getObject(doc.storageKey)).toString('utf8');
    const { fixArabic } = await import('@/lib/text');
    return NextResponse.json({ text: fixArabic(raw), translated: null });
  } catch {
    return NextResponse.json({ text: null, note: 'Stored file unavailable.' });
  }
}
