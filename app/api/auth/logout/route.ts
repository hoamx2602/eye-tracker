import { NextResponse } from 'next/server';
import { getUserCookieName } from '@/lib/user-auth';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(getUserCookieName(), '', { path: '/', maxAge: 0 });
  return response;
}
