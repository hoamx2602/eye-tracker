'use client';

import { FormEvent, useEffect, useState } from 'react';

type Doctor = { id: string; name: string; email: string; createdAt: string; _count: { doctorSessions: number; invitations: number } };

export default function AdminDoctorsPage() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { fetch('/api/admin/doctors').then((response) => response.ok ? response.json() : null).then((data) => data && setDoctors(data.doctors)); }, []);
  async function create(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null);
    const response = await fetch('/api/admin/doctors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error || 'Could not create doctor.');
    else { setDoctors((current) => [data.doctor, ...current]); setName(''); setEmail(''); setPassword(''); }
    setSaving(false);
  }
  return <div className="space-y-7"><div><h1 className="text-2xl font-bold">Doctor accounts</h1><p className="mt-1 text-sm text-slate-400">Doctors can view only their linked patients and test results. They cannot access system configuration.</p></div>
    <form onSubmit={create} className="grid gap-4 rounded-xl border border-slate-700 bg-slate-800/60 p-5 md:grid-cols-3">{error && <p className="md:col-span-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      <label className="text-sm text-slate-300">Name<input value={name} onChange={(event) => setName(event.target.value)} required className="mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2" /></label>
      <label className="text-sm text-slate-300">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2" /></label>
      <label className="text-sm text-slate-300">Temporary password<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required className="mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2" /></label>
      <button disabled={saving} className="md:col-span-3 justify-self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-50">{saving ? 'Creating…' : 'Create doctor account'}</button>
    </form>
    <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800/60">{doctors.length === 0 ? <p className="p-8 text-center text-slate-400">No doctor accounts.</p> : <table className="w-full text-left text-sm"><thead><tr className="border-b border-slate-700 text-xs uppercase text-slate-400"><th className="px-4 py-3">Doctor</th><th className="px-4 py-3">Sessions</th><th className="px-4 py-3">Links</th><th className="px-4 py-3">Created</th></tr></thead><tbody className="divide-y divide-slate-700">{doctors.map((doctor) => <tr key={doctor.id}><td className="px-4 py-3"><p className="font-medium text-white">{doctor.name}</p><p className="text-xs text-slate-400">{doctor.email}</p></td><td className="px-4 py-3">{doctor._count.doctorSessions}</td><td className="px-4 py-3">{doctor._count.invitations}</td><td className="px-4 py-3 text-slate-400">{new Date(doctor.createdAt).toLocaleString()}</td></tr>)}</tbody></table>}</div>
  </div>;
}
