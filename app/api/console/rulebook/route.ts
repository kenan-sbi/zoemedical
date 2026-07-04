import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, getRulebook, saveRulebook } from '@/lib/console';

// GET the surgeon's rulebook (defaults if unset). PUT to save edits.
export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ rules: await getRulebook() });
}

export async function PUT(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({} as any));
  const rules = body?.rules;
  if (!rules || typeof rules !== 'object') return NextResponse.json({ error: 'rules object required' }, { status: 400 });
  await saveRulebook(rules);
  return NextResponse.json({ rules: await getRulebook() });
}
