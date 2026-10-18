import { NextRequest, NextResponse } from 'next/server';
import * as bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/lib/request-auth';

export async function GET(request: NextRequest) {
  if (!await isAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const doctors = await prisma.user.findMany({
    where: { role: 'DOCTOR' }, orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, email: true, createdAt: true, _count: { select: { doctorSessions: true, invitations: true } } },
  });
  return NextResponse.json({ doctors });
}

export async function POST(request: NextRequest) {
  if (!await isAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
    return NextResponse.json({ error: 'Name, valid email and an 8+ character password are required.' }, { status: 400 });
  }
  if (await prisma.user.findUnique({ where: { email } })) {
    return NextResponse.json({ error: 'This email is already registered.' }, { status: 409 });
  }
  const doctor = await prisma.user.create({
    data: { name, email, passwordHash: await bcrypt.hash(password, 10), role: 'DOCTOR' },
    select: { id: true, name: true, email: true, createdAt: true },
  });
  return NextResponse.json({ doctor: { ...doctor, _count: { doctorSessions: 0, invitations: 0 } } }, { status: 201 });
}
