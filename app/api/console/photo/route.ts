import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, readPhoto } from '@/lib/console';

export const runtime = 'nodejs';

// Stream a stored console photo by key (auth-gated; only reads under uploads/console/).
export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const key = req.nextUrl.searchParams.get('key') ?? '';
  try {
    const { buf, mime } = await readPhoto(key);
    return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=3600' } });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
