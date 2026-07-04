import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// Delete a persisted deliverable (an AuditLog row scoped to this case). No clinical data touched.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; did: string } }) {
  const row = await prisma.auditLog.findUnique({ where: { id: params.did } });
  if (!row || row.action !== 'DELIVERABLE' || row.resource !== params.id) {
    return NextResponse.json({ error: 'deliverable not found' }, { status: 404 });
  }
  await prisma.auditLog.delete({ where: { id: row.id } });
  return NextResponse.json({ ok: true });
}
