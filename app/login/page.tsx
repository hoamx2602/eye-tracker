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
  const [showPassword, setShowPassword] = useState(false);
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
              <div className="mt-1.5 relative">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} required
                  autoComplete="current-password" className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2.5 pr-10 text-white outline-none focus:border-blue-500" />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-white"
                >
                  {showPassword ? (
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l14 14M8.5 8.7a2 2 0 0 0 2.8 2.8M6.2 6.2C4.3 7.4 2.9 9.1 2 10c1.5 2.7 4.8 6 8 6 1.2 0 2.4-.4 3.5-1.1M10 4c3.2 0 6.5 3.3 8 6a14.6 14.6 0 0 1-2.1 2.8" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2 10c1.5-2.7 4.8-6 8-6s6.5 3.3 8 6c-1.5 2.7-4.8 6-8 6s-6.5-3.3-8-6Z" />
                      <circle cx="10" cy="10" r="2.2" />
                    </svg>
                  )}
                </button>
              </div>
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
