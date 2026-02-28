/**
 * POST /api/admin/register — create an admin account (protected).
 * Body: { email: string, password: string, name?: string }
 * Protection: header x-admin-register-secret must match ADMIN_REGISTER_SECRET,
 * OR allow when no admins exist (first-time setup).
 * Env: ADMIN_REGISTER_SECRET (optional; if set, required for registration when admins already exist).
 */
import { NextRequest, NextResponse } from 'next/server';
import * as bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isAllowedToRegister(request: NextRequest, adminCount: number): boolean {
  const secret = process.env.ADMIN_REGISTER_SECRET;
  const provided = request.headers.get('x-admin-register-secret');
  // First-time: no admins yet → allow (no secret required).
  if (adminCount === 0) return true;
  // Already have admins: require secret if configured.
  if (!secret) return false;
  return provided === secret && secret.length > 0;
}

export async function POST(request: NextRequest) {
  try {
    const adminCount = await prisma.admin.count();
    if (!isAllowedToRegister(request, adminCount)) {
      return NextResponse.json(
        { error: 'Forbidden: valid ADMIN_REGISTER_SECRET required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { email, password, name } = body as { email?: string; password?: string; name?: string };

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid email' }, { status: 400 });
    }
    const trimmedEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid password' }, { status: 400 });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 }
      );
    }

    const existing = await prisma.admin.findUnique({ where: { email: trimmedEmail } });
    if (existing) {
      return NextResponse.json(
        { error: 'An admin with this email already exists' },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const admin = await prisma.admin.create({
      data: {
        email: trimmedEmail,
        passwordHash,
        name: name != null && typeof name === 'string' ? name.trim() || undefined : undefined,
      },
    });

    return NextResponse.json(
      { id: admin.id, email: admin.email, name: admin.name ?? null },
      { status: 201 }
    );
  } catch (e) {
    const err = e as Error;
    console.error('[api/admin/register]', err);
    const message = process.env.NODE_ENV === 'development' ? err.message : 'Registration failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
