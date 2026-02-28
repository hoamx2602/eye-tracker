/**
 * GET /api/admin/me — return current admin from JWT cookie (for auth guard / layout).
 * 200 + { admin: { id, email, name } } or 401.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminCookieName, verifyAdminToken } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  try {
    const cookieName = getAdminCookieName();
    const token = request.cookies.get(cookieName)?.value;
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const payload = await verifyAdminToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    }

    return NextResponse.json({
      admin: { id: payload.sub, email: payload.email, name: payload.name },
    });
  } catch (e) {
    const err = e as Error;
    console.error('[api/admin/me]', err);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
