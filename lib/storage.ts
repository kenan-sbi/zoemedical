// Object storage seam. One place decides WHERE bytes live:
//   - Supabase Storage when SUPABASE_SERVICE_ROLE_KEY is set (serverless / Vercel — disk is ephemeral).
//   - Local ./ disk otherwise (local dev — unchanged behaviour, no cloud needed).
// storageKey strings are identical in both modes (e.g. "uploads/<hash>__<name>"), so callers and the
// DB don't care which backend is active. This is the PHI storage boundary.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { join, resolve, dirname } from 'path';

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'documents';

let _client: SupabaseClient | null | undefined;
function supabase(): SupabaseClient | null {
  if (_client !== undefined) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // service role: server-side, bypasses RLS
  _client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return _client;
}

// Persist bytes under `key`. Upsert so a re-upload of the same content is idempotent.
export async function putObject(key: string, buf: Buffer, contentType?: string): Promise<void> {
  const sb = supabase();
  if (sb) {
    const { error } = await sb.storage.from(BUCKET).upload(key, buf, {
      contentType: contentType || 'application/octet-stream',
      upsert: true,
    });
    if (error) throw new Error(`storage put failed: ${error.message}`);
    return;
  }
  const path = join(process.cwd(), key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf);
}

// Fetch bytes for `key`. Throws if missing (callers already handle read failures).
export async function getObject(key: string): Promise<Buffer> {
  const sb = supabase();
  if (sb) {
    const { data, error } = await sb.storage.from(BUCKET).download(key);
    if (error || !data) throw new Error(`storage get failed: ${error?.message ?? 'not found'}`);
    return Buffer.from(await data.arrayBuffer());
  }
  return readFile(resolve(process.cwd(), key));
}
