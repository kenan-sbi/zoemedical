// Fingerprint-keyed cache for expensive per-case LLM outputs (Clinical Attention, role summaries).
// Stored in the existing AuditLog table (action='CACHE', userId null so it never shows in the audit
// viewer) — NO schema change. A result is reused until the underlying facts change (new fingerprint)
// or the caller forces a refresh. This is what makes a reload free instead of re-calling Gemini.
import { prisma } from './db';
import { createHash } from 'crypto';

export function recordFingerprint(records: { id: string; status: string; effective: Date | string | null; effectiveApprox?: boolean; negated: boolean; coding: unknown }[]): string {
  const sig = records
    .map((r) => `${r.id}:${r.status}:${r.effective ? +new Date(r.effective) : 0}:${r.effectiveApprox ? 'a' : ''}:${r.negated}:${(r.coding as any)?.display ?? ''}`)
    .sort()
    .join('|');
  return createHash('sha256').update(sig).digest('hex');
}

type Kind = 'attention' | 'summary';

// Return the cached payload if one exists for this (case, kind, fingerprint, role); else null.
export async function readCache(caseId: string, kind: Kind, fp: string, role: string | null = null): Promise<any | null> {
  const rows = await prisma.auditLog.findMany({ where: { action: 'CACHE', resource: caseId }, orderBy: { createdAt: 'desc' }, take: 40 });
  for (const r of rows) {
    const m: any = r.meta;
    if (m?.kind === kind && m?.fp === fp && (m?.role ?? null) === (role ?? null)) return m.payload;
  }
  return null;
}

// Store a fresh payload, replacing any prior entry of the same (case, kind, role) so it can't grow.
export async function writeCache(caseId: string, kind: Kind, fp: string, payload: any, role: string | null = null): Promise<void> {
  try {
    const rows = await prisma.auditLog.findMany({ where: { action: 'CACHE', resource: caseId } });
    const stale = rows.filter((r) => { const m: any = r.meta; return m?.kind === kind && (m?.role ?? null) === (role ?? null); });
    if (stale.length) await prisma.auditLog.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
    await prisma.auditLog.create({ data: { action: 'CACHE', resource: caseId, meta: { kind, fp, role: role ?? null, payload } } });
  } catch { /* caching must never break the request */ }
}
