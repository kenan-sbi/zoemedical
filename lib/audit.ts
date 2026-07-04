// Audit trail — who did what (VIEW / EDIT / SIGN / EXPORT ...). Best-effort; never blocks the action.
import { prisma } from './db';
import type { SessionUser } from './auth';

export async function logAudit(user: SessionUser | null, action: string, resource: string, meta?: any) {
  try {
    await prisma.auditLog.create({ data: { userId: user?.id ?? null, action, resource, meta: meta ?? undefined } });
  } catch { /* auditing must never break the request */ }
}
