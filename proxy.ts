/**
 * Admin auth guard: protect /admin (except /admin/login).
 * Redirect to /admin/login when no valid admin_token cookie.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAdminCookieName, verifyAdminToken } from '@/lib/admin-auth';
import {
  assessmentPath,
  getInvitationCookieName,
  getSessionCookieName,
  getUserCookieName,
  safeReturnPath,
  verifyInvitationAccessToken,
  verifySessionAccessToken,
  verifyUserToken,
} from '@/lib/user-auth';

const ADMIN_LOGIN = '/admin/login';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Allow /admin/login without auth
  if (pathname === ADMIN_LOGIN) {
    return NextResponse.next();
  }
  if (pathname.startsWith('/admin')) {
    const token = request.cookies.get(getAdminCookieName())?.value;
    if (token && await verifyAdminToken(token)) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = ADMIN_LOGIN;
    url.searchParams.set('from', pathname);
    return NextResponse.redirect(url);
  }

  const isAssessment = pathname === '/eye-tracking' || pathname.startsWith('/eye-tracking/') ||
    pathname === '/facial-droop' || pathname === '/iop';
  const isPortal = pathname === '/doctor' || pathname.startsWith('/doctor/') ||
    pathname === '/account' || pathname.startsWith('/account/');
  const isResults = pathname.startsWith('/results/');
  if (isAssessment || isPortal || isResults) {
    const token = request.cookies.get(getUserCookieName())?.value;
    const user = token ? await verifyUserToken(token) : null;
    const inviteToken = request.cookies.get(getInvitationCookieName())?.value;
    const invite = inviteToken ? await verifyInvitationAccessToken(inviteToken) : null;
    const sessionToken = request.cookies.get(getSessionCookieName())?.value;
    const assessmentSession = sessionToken ? await verifySessionAccessToken(sessionToken) : null;
    const invitedAssessment = isAssessment && invite && assessmentPath(invite.assessmentType) ===
      (pathname.startsWith('/eye-tracking') ? '/eye-tracking' : pathname);
    const hasAccess = user || invitedAssessment || (isResults && assessmentSession);
    if (!hasAccess) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('from', safeReturnPath(`${pathname}${request.nextUrl.search}`));
      return NextResponse.redirect(url);
    }
    if (pathname.startsWith('/doctor') && user?.role !== 'DOCTOR') {
      return NextResponse.redirect(new URL('/account', request.url));
    }
    if (pathname.startsWith('/account') && user?.role !== 'PATIENT') {
      return NextResponse.redirect(new URL('/doctor', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/admin', '/admin/:path*',
    '/doctor', '/doctor/:path*',
    '/account', '/account/:path*',
    '/eye-tracking', '/eye-tracking/:path*',
    '/facial-droop', '/iop',
    '/results/:path*',
  ],
};
