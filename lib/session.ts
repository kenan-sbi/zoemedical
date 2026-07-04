// Resolve the current user for API routes, going through the auth wrapper (never Supabase directly).
import type { NextRequest } from 'next/server';
import { getSessionUser, DEV_USER, type SessionUser } from './auth';
import { prisma } from './db';

export const ACT_COOKIE = 'zoe_uid'; // dev act-as: which team member you're acting as

// Ensure a default clinic + the dev owner exist (dev bootstrap). Returns the clinic id.
async function ensureDevClinic(): Promise<string> {
  let clinic = await prisma.clinic.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!clinic) clinic = await prisma.clinic.create({ data: { name: 'Zoe Medical' } });
  await prisma.user.upsert({
    where: { id: DEV_USER.id },
    update: { clinicId: clinic.id },
    create: { id: DEV_USER.id, email: DEV_USER.email, role: 'OWNER', name: 'Dr. Dev Reviewer', license: 'DEV-0001', clinicId: clinic.id },
  });
  return clinic.id;
}

export async function currentUser(req: NextRequest): Promise<SessionUser | null> {
  // DEV: role + clinic come from the DB so team roles actually take effect, and an "act-as" cookie
  // lets you switch team members to exercise role restrictions. Off in production (real auth below).
  if (process.env.DEV_NO_AUTH === '1') {
    await ensureDevClinic();
    const uid = req.cookies.get(ACT_COOKIE)?.value;
    const chosen = uid ? await prisma.user.findUnique({ where: { id: uid } }) : null;
    const u = chosen ?? (await prisma.user.findUnique({ where: { id: DEV_USER.id } }));
    if (u) return { id: u.id, email: u.email, role: u.role, clinicId: u.clinicId ?? null };
    return { ...DEV_USER, clinicId: null };
  }

  const token = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const authed = await getSessionUser(token);
  if (!authed) return null;
  // Load the app-side role/clinic from our User table (source of truth for RBAC).
  const dbUser = await prisma.user.findUnique({ where: { id: authed.id } }).catch(() => null);
  return { id: authed.id, email: authed.email, role: dbUser?.role ?? authed.role, clinicId: dbUser?.clinicId ?? null };
}

// Role helpers — a single place the RBAC rules live.
export const CAN_SIGN = ['OWNER', 'REVIEWER'];
export const CAN_EDIT = ['OWNER', 'REVIEWER', 'CLINICIAN'];
export const CAN_MANAGE_TEAM = ['OWNER'];
export function can(user: SessionUser | null, roles: string[]) { return !!user && roles.includes(user.role); }
