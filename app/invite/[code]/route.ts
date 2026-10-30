import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  assessmentPath,
  getInvitationCookieName,
  getInvitationCookieOptions,
  signInvitationAccessToken,
} from '@/lib/user-auth';

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  const code = rawCode.trim().toUpperCase();
  const invitation = await prisma.testInvitation.findUnique({ where: { code } });
  const expired = invitation?.expiresAt && invitation.expiresAt.getTime() <= Date.now();
  const exhausted = invitation ? invitation.usedCount >= invitation.maxUses : true;
  if (!invitation || !invitation.active || expired || exhausted) {
    return NextResponse.redirect(new URL('/invite-invalid', request.url));
  }

  const redirectUrl = new URL(assessmentPath(invitation.assessmentType), request.url);
  const response = NextResponse.redirect(redirectUrl);
  const token = await signInvitationAccessToken(
    { code: invitation.code, assessmentType: invitation.assessmentType },
    invitation.expiresAt,
  );
  response.cookies.set(
    getInvitationCookieName(),
    token,
    getInvitationCookieOptions(invitation.expiresAt),
  );
  return response;
}
