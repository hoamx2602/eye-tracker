import { NextRequest, NextResponse } from 'next/server';
import * as bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { getUserCookieName, getUserCookieOptions, signUserToken } from '@/lib/user-auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const identifierRaw = typeof body.identifier === 'string' ? body.identifier : typeof body.email === 'string' ? body.email : '';
    const identifier = identifierRaw.trim();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!identifier || !password) {
      return NextResponse.json({ error: 'Username/email and password are required.' }, { status: 400 });
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier.toLowerCase() },
          { username: identifier },
        ],
      },
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return NextResponse.json({ error: 'Invalid username/email or password.' }, { status: 401 });
    }
    if (user.role !== 'DOCTOR' && user.role !== 'PATIENT') {
      return NextResponse.json({ error: 'This account cannot access the portal.' }, { status: 403 });
    }

    const token = await signUserToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
    const response = NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
    response.cookies.set(getUserCookieName(), token, getUserCookieOptions());
    return response;
  } catch (error) {
    console.error('[api/auth/login]', error);
    return NextResponse.json({ error: 'Login failed.' }, { status: 500 });
  }
}
