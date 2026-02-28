'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' });
    router.push('/admin/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-b border-slate-700 bg-slate-800/80 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <nav className="flex items-center gap-6">
            <Link
              href="/admin"
              className="text-slate-300 hover:text-white font-medium transition"
            >
              Dashboard
            </Link>
            <Link
              href="/admin/sessions"
              className="text-slate-300 hover:text-white font-medium transition"
            >
              Sessions
            </Link>
          </nav>
          <button
            type="button"
            onClick={handleLogout}
            className="text-slate-400 hover:text-red-400 text-sm transition"
          >
            Log out
          </button>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
