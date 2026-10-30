import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { invitationAccessFromRequest, userFromRequest } from '@/lib/request-auth';

export async function GET(request: NextRequest) {
  const payload = await userFromRequest(request);
  const inviteAccess = await invitationAccessFromRequest(request);
  if (!payload && !inviteAccess) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const invitation = inviteAccess
    ? await prisma.testInvitation.findUnique({
        where: { code: inviteAccess.code },
        select: { assessmentType: true, doctor: { select: { id: true, name: true, email: true } } },
      })
    : null;
  return NextResponse.json({
    user: payload,
    guest: !payload && inviteAccess ? {} : null,
    invitation: invitation
      ? { assessmentType: invitation.assessmentType, doctor: invitation.doctor }
      : null,
  });
}
