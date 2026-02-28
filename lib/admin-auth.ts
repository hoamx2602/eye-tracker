/**
 * Admin JWT auth: sign, verify, cookie name.
 * Env: JWT_SECRET (required for admin auth).
 */
import { SignJWT, jwtVerify } from 'jose';

const COOKIE_NAME = 'admin_token';
const EXPIRES_IN = '24h'; // 24 hours

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET must be set and at least 16 characters');
  }
  return new TextEncoder().encode(secret);
}

export type AdminPayload = {
  sub: string; // admin id
  email: string;
  name: string | null;
};

export async function signAdminToken(payload: AdminPayload): Promise<string> {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(EXPIRES_IN)
    .sign(getSecret());
  return token;
}

export async function verifyAdminToken(token: string): Promise<AdminPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const sub = payload.sub as string;
    const email = payload.email as string;
    const name = (payload.name as string | null) ?? null;
    if (!sub || !email) return null;
    return { sub, email, name };
  } catch {
    return null;
  }
}

export function getAdminCookieName(): string {
  return COOKIE_NAME;
}

export function getAdminCookieOptions(): { httpOnly: boolean; path: string; sameSite: 'lax'; secure: boolean; maxAge: number } {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24, // 24h in seconds
  };
}
