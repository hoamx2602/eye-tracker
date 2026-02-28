/**
 * POST /api/admin/login
 * Body: { email: string, password: string }
 * On success: set HTTP-only cookie with JWT, return { admin: { id, email, name } }.
 * On failure: 401.
 */
import { NextRequest, NextResponse } from 'next/server';
import * as bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import {
  signAdminToken,
  getAdminCookieName,
  getAdminCookieOptions,
} from '@/lib/admin-auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body as { email?: string; password?: string };

    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid email or password' },
        { status: 400 }
      );
    }

    const trimmedEmail = email.trim().toLowerCase();
    const admin = await prisma.admin.findUnique({ where: { email: trimmedEmail } });
    if (!admin) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const token = await signAdminToken({
      sub: admin.id,
      email: admin.email,
      name: admin.name ?? null,
    });

    const res = NextResponse.json({
      admin: { id: admin.id, email: admin.email, name: admin.name ?? null },
    });

    const cookieName = getAdminCookieName();
    const opts = getAdminCookieOptions();
    res.cookies.set(cookieName, token, opts);

    return res;
  } catch (e) {
    const err = e as Error;
    console.error('[api/admin/login]', err);
    const message = process.env.NODE_ENV === 'development' ? err.message : 'Login failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
