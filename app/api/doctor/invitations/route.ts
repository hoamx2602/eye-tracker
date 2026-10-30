import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { userFromRequest } from '@/lib/request-auth';
import { ASSESSMENT_OPTIONS } from '@/lib/user-auth';

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user || user.role !== 'DOCTOR') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const invitations = await prisma.testInvitation.findMany({ where: { doctorId: user.sub }, orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ invitations });
}

export async function POST(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user || user.role !== 'DOCTOR') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const allowed = ASSESSMENT_OPTIONS.map((option) => option.value) as readonly string[];
  const assessmentType = typeof body.assessmentType === 'string' && allowed.includes(body.assessmentType)
    ? body.assessmentType
    : '';
  const maxUses = Math.min(100, Math.max(1, Number(body.maxUses) || 1));
  const expiresInDays = Math.min(365, Math.max(1, Number(body.expiresInDays) || 30));
  if (!assessmentType) return NextResponse.json({ error: 'Choose a valid assessment.' }, { status: 400 });
  const invitation = await prisma.testInvitation.create({
    data: {
      code: randomBytes(5).toString('hex').toUpperCase(),
      assessmentType,
      doctorId: user.sub,
      maxUses,
      expiresAt: new Date(Date.now() + expiresInDays * 86_400_000),
      note: typeof body.note === 'string' ? body.note.trim().slice(0, 500) || null : null,
    },
  });
  return NextResponse.json({ invitation }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user || user.role !== 'DOCTOR') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id: unknown): id is string => typeof id === 'string').slice(0, 500)
    : [];
  if (ids.length === 0) return NextResponse.json({ error: 'Choose at least one link.' }, { status: 400 });
  // Sessions keep their data: Session.invitationId is ON DELETE SET NULL.
  const { count } = await prisma.testInvitation.deleteMany({ where: { id: { in: ids }, doctorId: user.sub } });
  return NextResponse.json({ deleted: count });
}
