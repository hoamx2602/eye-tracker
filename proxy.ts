/**
 * Admin auth guard: protect /admin (except /admin/login).
 * Redirect to /admin/login when no valid admin_token cookie.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAdminCookieName, verifyAdminToken } from '@/lib/admin-auth';

const ADMIN_LOGIN = '/admin/login';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Allow /admin/login without auth
  if (pathname === ADMIN_LOGIN) {
    return NextResponse.next();
  }
  // Protect /admin and /admin/*
  if (!pathname.startsWith('/admin')) {
    return NextResponse.next();
  }

  const cookieName = getAdminCookieName();
  const token = request.cookies.get(cookieName)?.value;
  if (!token) {
    const url = request.nextUrl.clone();
    url.pathname = ADMIN_LOGIN;
    url.searchParams.set('from', pathname);
    return NextResponse.redirect(url);
  }

  try {
    const payload = await verifyAdminToken(token);
    if (!payload) {
      const url = request.nextUrl.clone();
      url.pathname = ADMIN_LOGIN;
      url.searchParams.set('from', pathname);
      return NextResponse.redirect(url);
    }
  } catch {
    const url = request.nextUrl.clone();
    url.pathname = ADMIN_LOGIN;
    url.searchParams.set('from', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};
