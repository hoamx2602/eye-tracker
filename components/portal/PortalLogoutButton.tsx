'use client';

import { useRouter } from 'next/navigation';

export default function PortalLogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }
  return <button type="button" onClick={logout} className="text-sm text-slate-400 hover:text-red-300">Log out</button>;
}
