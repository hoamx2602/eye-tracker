/**
 * POST /api/admin/logout — clear admin session cookie.
 */
import { NextResponse } from 'next/server';
import { getAdminCookieName } from '@/lib/admin-auth';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  const cookieName = getAdminCookieName();
  res.cookies.set(cookieName, '', { path: '/', maxAge: 0 });
  return res;
}
