import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, savePhoto } from '@/lib/console';

export const runtime = 'nodejs';

// Store one photo, return its storageKey. The client uploads each slot, then submits the case.
export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 });
  if (!/^image\//.test(file.type)) return NextResponse.json({ error: 'images only (JPG/PNG/WEBP)' }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > 12 * 1024 * 1024) return NextResponse.json({ error: 'image too large (max 12MB)' }, { status: 400 });
  const key = await savePhoto(buf, file.type);
  return NextResponse.json({ key });
}
