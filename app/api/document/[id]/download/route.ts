import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getObject } from '@/lib/storage';

export const runtime = 'nodejs';

// Stream the ORIGINAL uploaded file back for download (from Supabase Storage or the local volume).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const doc = await prisma.document.findUnique({ where: { id: params.id } });
  if (!doc || !doc.storageKey) return NextResponse.json({ error: 'document not found' }, { status: 404 });
  try {
    const buf = await getObject(doc.storageKey);
    const safe = doc.filename.replace(/"/g, '');
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': doc.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${safe}"`,
        'Content-Length': String(buf.length),
      },
    });
  } catch {
    return NextResponse.json({ error: 'original file is not available on this server' }, { status: 404 });
  }
}
