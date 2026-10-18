'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeReturnPath } from '@/lib/user-auth';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
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
            <h1 className="mt-2 text-2xl font-bold">{mode === 'login' ? 'Sign in' : 'Create patient account'}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {mode === 'login'
                ? 'Continue an assessment or open your clinical workspace.'
                : 'Create an account to keep your assessment history together.'}
            </p>
          </div>

          <div className="grid grid-cols-2 rounded-xl bg-slate-800 p-1 mb-6" role="tablist">
            <button type="button" onClick={() => { setMode('login'); setError(null); }}
              className={`rounded-lg py-2 text-sm font-medium ${mode === 'login' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              Sign in
            </button>
            <button type="button" onClick={() => { setMode('register'); setError(null); }}
              className={`rounded-lg py-2 text-sm font-medium ${mode === 'register' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              New patient
            </button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
            {mode === 'register' && (
              <label className="block text-sm text-slate-300">
                Full name
                <input value={name} onChange={(event) => setName(event.target.value)} required
                  autoComplete="name" className="mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-blue-500" />
              </label>
            )}
            <label className="block text-sm text-slate-300">
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required
                autoComplete="email" className="mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-blue-500" />
            </label>
            <label className="block text-sm text-slate-300">
              Password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className="mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-blue-500" />
            </label>
            <button disabled={loading} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <p className="mt-5 text-xs leading-relaxed text-slate-500">
            Doctor accounts are created by a system administrator and use the same sign-in form.
          </p>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
