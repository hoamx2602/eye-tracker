'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RedeemInvitePage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (normalized) router.push(`/invite/${normalized}`);
  }
  return <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4"><div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-7"><Link href="/" className="text-sm text-slate-400">← Home</Link><h1 className="mt-5 text-2xl font-bold">Enter your test code</h1><p className="mt-2 text-sm text-slate-400">Use the code supplied by your doctor to open the correct assessment and link the result to them.</p><form onSubmit={submit} className="mt-6 space-y-3"><input autoFocus value={code} onChange={(event) => setCode(event.target.value)} placeholder="e.g. A1B2C3D4E5" className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-3 font-mono uppercase tracking-widest outline-none focus:border-blue-500" /><button className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold hover:bg-blue-500">Continue</button></form></div></main>;
}
