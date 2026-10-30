import type { NextRequest } from 'next/server';
import { getAdminCookieName, verifyAdminToken } from '@/lib/admin-auth';
import {
  getInvitationCookieName,
  getSessionCookieName,
  getUserCookieName,
  verifyInvitationAccessToken,
  verifySessionAccessToken,
  verifyUserToken,
  type InvitationAccessPayload,
  type SessionAccessPayload,
  type UserPayload,
} from '@/lib/user-auth';

export async function userFromRequest(request: NextRequest): Promise<UserPayload | null> {
  const token = request.cookies.get(getUserCookieName())?.value;
  return token ? verifyUserToken(token) : null;
}

export async function isAdminRequest(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(getAdminCookieName())?.value;
  return token ? Boolean(await verifyAdminToken(token)) : false;
}

export async function invitationAccessFromRequest(request: NextRequest): Promise<InvitationAccessPayload | null> {
  const token = request.cookies.get(getInvitationCookieName())?.value;
  return token ? verifyInvitationAccessToken(token) : null;
}

export async function sessionAccessFromRequest(request: NextRequest): Promise<SessionAccessPayload | null> {
  const token = request.cookies.get(getSessionCookieName())?.value;
  return token ? verifySessionAccessToken(token) : null;
}
