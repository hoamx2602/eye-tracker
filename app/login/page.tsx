'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeReturnPath } from '@/lib/user-auth';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Unable to continue.');
        return;
      }
      const fallback = data.user?.role === 'DOCTOR' ? '/doctor' : '/account';
      router.push(safeReturnPath(searchParams.get('from'), fallback));
      router.refresh();
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link href="/" className="text-sm text-slate-400 hover:text-white">← Back to assessments</Link>
        <div className="mt-5 rounded-2xl border border-slate-700 bg-slate-900/80 shadow-2xl p-7">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">Neurotree portal</p>
            <h1 className="mt-2 text-2xl font-bold">Sign in</h1>
            <p className="mt-1 text-sm text-slate-400">Open your clinical workspace.</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
            <label className="block text-sm text-slate-300">
              Username or email
              <input type="text" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required
                autoComplete="username" className="mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-blue-500" />
            </label>
            <label className="block text-sm text-slate-300">
              Password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8}
                autoComplete="current-password" className="mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-blue-500" />
            </label>
            <button disabled={loading} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
              {loading ? 'Please wait…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
