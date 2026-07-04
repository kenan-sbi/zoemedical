import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, parseNoteFields } from '@/lib/console';
import { getOCRProvider } from '@/lib/ocr';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Import a case NOTE (PDF/TXT) and extract the non-photo fields. Reuses the OCR seam for text, then
// pulls structured fields from the surgeon's own record. Images are not accepted here (use photos).
export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 });
  if (/^image\//.test(file.type)) return NextResponse.json({ error: 'That looks like an image — drop it in the photo area. This is for text notes (PDF/TXT).' }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > 15 * 1024 * 1024) return NextResponse.json({ error: 'file too large (max 15MB)' }, { status: 400 });

  const { text, source } = await getOCRProvider().extract({ buf, mimeType: file.type, filename: file.name });
  if (!text || !text.trim()) {
    return NextResponse.json({ error: 'No readable text found. If this is a scanned/photo PDF it has no text layer — paste the details or use a text-based file.' }, { status: 422 });
  }
  const fields = await parseNoteFields(text);
  return NextResponse.json({ fields, source, chars: text.length, filename: file.name });
}
