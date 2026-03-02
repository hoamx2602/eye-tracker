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
    <div className="min-h-screen bg-slate-900 text-slate-100 overflow-y-auto" style={{ height: '100vh' }}>
      <header className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-slate-700 bg-slate-800 shadow-sm">
        <div className="h-full max-w-6xl mx-auto px-4 flex items-center justify-between">
          <nav className="flex items-center gap-6">
            <Link
              href="/admin"
              className={`font-medium transition ${pathname === '/admin' ? 'text-white' : 'text-slate-300 hover:text-white'}`}
            >
              Dashboard
            </Link>
            <Link
              href="/admin/sessions"
              className={`font-medium transition ${pathname?.startsWith('/admin/sessions') && !pathname?.startsWith('/admin/tests') ? 'text-white' : 'text-slate-300 hover:text-white'}`}
            >
              Sessions
            </Link>
            <Link
              href="/admin/tests"
              className={`font-medium transition ${pathname?.startsWith('/admin/tests') ? 'text-white' : 'text-slate-300 hover:text-white'}`}
            >
              Tests
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
      <main className="pt-14 min-h-screen">
        <div className="max-w-6xl mx-auto px-4 py-6">{children}</div>
      </main>
    </div>
  );
}
