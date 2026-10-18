import { SignJWT, jwtVerify } from 'jose';

const USER_COOKIE_NAME = 'portal_token';
const INVITATION_COOKIE_NAME = 'assessment_invite';
const SESSION_COOKIE_NAME = 'assessment_session';
const EXPIRES_IN = '7d';

export type UserRole = 'DOCTOR' | 'PATIENT';

export type UserPayload = {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
};

export type InvitationAccessPayload = {
  code: string;
  assessmentType: string;
};

export type SessionAccessPayload = { sessionId: string };

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET must be set and at least 16 characters');
  }
  return new TextEncoder().encode(secret);
}

export async function signUserToken(payload: UserPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(EXPIRES_IN)
    .sign(getSecret());
}

export async function verifyUserToken(token: string): Promise<UserPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const role = payload.role;
    if (
      !payload.sub ||
      typeof payload.email !== 'string' ||
      typeof payload.name !== 'string' ||
      (role !== 'DOCTOR' && role !== 'PATIENT')
    ) return null;
    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      role,
    };
  } catch {
    return null;
  }
}

export async function signInvitationAccessToken(payload: InvitationAccessPayload, expiresAt?: Date | null) {
  const token = new SignJWT({ ...payload, tokenType: 'invitation' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt();
  token.setExpirationTime(expiresAt ? Math.floor(expiresAt.getTime() / 1000) : '30d');
  return token.sign(getSecret());
}

export async function verifyInvitationAccessToken(token: string): Promise<InvitationAccessPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.tokenType !== 'invitation' || typeof payload.code !== 'string' || typeof payload.assessmentType !== 'string') return null;
    return {
      code: payload.code,
      assessmentType: payload.assessmentType,
    };
  } catch {
    return null;
  }
}

export async function signSessionAccessToken(payload: SessionAccessPayload) {
  return new SignJWT({ ...payload, tokenType: 'assessment_session' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(getSecret());
}

export async function verifySessionAccessToken(token: string): Promise<SessionAccessPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload.tokenType === 'assessment_session' && typeof payload.sessionId === 'string'
      ? { sessionId: payload.sessionId }
      : null;
  } catch {
    return null;
  }
}

export const getUserCookieName = () => USER_COOKIE_NAME;
export const getInvitationCookieName = () => INVITATION_COOKIE_NAME;
export const getSessionCookieName = () => SESSION_COOKIE_NAME;

export function getUserCookieOptions() {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 7,
  };
}

export function getInvitationCookieOptions(expiresAt?: Date | null) {
  const defaultMaxAge = 60 * 60 * 24 * 30;
  const untilExpiry = expiresAt
    ? Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
    : defaultMaxAge;
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: Math.min(defaultMaxAge, untilExpiry),
  };
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24,
  };
}

export function safeReturnPath(value: unknown, fallback = '/'): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : fallback;
}

export function assessmentPath(type: string): string {
  if (type === 'FACIAL_DROOP') return '/facial-droop';
  if (type === 'IOP') return '/iop';
  return '/eye-tracking';
}

export const ASSESSMENT_OPTIONS = [
  { value: 'EYE_TRACKING', label: 'Eye tracking' },
  { value: 'FACIAL_DROOP', label: 'Facial droop' },
  { value: 'IOP', label: 'IOP risk' },
] as const;

export function assessmentLabel(type: string | null | undefined): string {
  return ASSESSMENT_OPTIONS.find((option) => option.value === type)?.label ?? 'Eye tracking';
}
