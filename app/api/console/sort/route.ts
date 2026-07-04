import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, sortAndSuggest } from '@/lib/console';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Classify dropped photos by angle + suggest sex/stage. Suggestions only — the surgeon confirms.
export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const keys = Array.isArray(b.keys) ? b.keys.filter((k: any) => typeof k === 'string') : [];
  if (keys.length === 0) return NextResponse.json({ error: 'no photos' }, { status: 400 });
  const result = await sortAndSuggest(keys);
  return NextResponse.json(result);
}
