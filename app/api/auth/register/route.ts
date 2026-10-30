import { NextRequest, NextResponse } from 'next/server';
import * as bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { getUserCookieName, getUserCookieOptions, signUserToken } from '@/lib/user-auth';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!name || !EMAIL_PATTERN.test(email) || password.length < 8) {
      return NextResponse.json(
        { error: 'Enter your name, a valid email and a password of at least 8 characters.' },
        { status: 400 },
      );
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 });

    const user = await prisma.user.create({
      data: { name, email, passwordHash: await bcrypt.hash(password, 10), role: 'PATIENT' },
    });
    const token = await signUserToken({ sub: user.id, email: user.email, name: user.name, role: 'PATIENT' });
    const response = NextResponse.json(
      { user: { id: user.id, email: user.email, name: user.name, role: user.role } },
      { status: 201 },
    );
    response.cookies.set(getUserCookieName(), token, getUserCookieOptions());
    return response;
  } catch (error) {
    console.error('[api/auth/register]', error);
    return NextResponse.json({ error: 'Registration failed.' }, { status: 500 });
  }
}
