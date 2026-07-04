// AUTH WRAPPER — the guardrail. All auth goes through this interface, never Supabase directly.
// When you move in-Kingdom, swap the implementation here (Keycloak/self-hosted) and NOTHING
// else in the app changes. Do not call supabase-js for auth anywhere outside this file.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lazy client so the app boots (and `npm run dev`) even when Supabase env is unset for local dev.
let _client: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error('Supabase not configured. Set SUPABASE_URL/SUPABASE_ANON_KEY, or DEV_NO_AUTH=1 for local dev.');
    }
    _client = createClient(url, key);
  }
  return _client;
}

export interface SessionUser { id: string; email: string; role: string; clinicId?: string | null; }

// DEV ONLY: with DEV_NO_AUTH=1 the auth check is bypassed so the extraction loop is testable
// without Supabase keys. MUST be off in any environment that touches real data.
export const DEV_USER: SessionUser = { id: 'dev-user', email: 'dev@local', role: 'OWNER' };

export async function getSessionUser(accessToken: string): Promise<SessionUser | null> {
  if (process.env.DEV_NO_AUTH === '1') return DEV_USER;
  const { data, error } = await client().auth.getUser(accessToken);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? '', role: data.user.user_metadata?.role ?? 'COORDINATOR' };
}
export async function signIn(email: string, password: string) {
  return client().auth.signInWithPassword({ email, password });
}
export function requireRole(user: SessionUser | null, roles: string[]) {
  if (!user || !roles.includes(user.role)) throw new Error('forbidden');
}
