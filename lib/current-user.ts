import { cookies } from 'next/headers';
import { getSessionCookieName, getUserCookieName, verifySessionAccessToken, verifyUserToken } from '@/lib/user-auth';

export async function currentPortalUser() {
  const store = await cookies();
  const token = store.get(getUserCookieName())?.value;
  return token ? verifyUserToken(token) : null;
}

export async function currentAssessmentSession() {
  const store = await cookies();
  const token = store.get(getSessionCookieName())?.value;
  return token ? verifySessionAccessToken(token) : null;
}
