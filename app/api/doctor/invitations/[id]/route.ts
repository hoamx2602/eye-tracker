import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { userFromRequest } from '@/lib/request-auth';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await userFromRequest(request);
  if (!user || user.role !== 'DOCTOR') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const existing = await prisma.testInvitation.findFirst({ where: { id, doctorId: user.sub } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const invitation = await prisma.testInvitation.update({ where: { id }, data: { active: !existing.active } });
  return NextResponse.json({ invitation });
}
