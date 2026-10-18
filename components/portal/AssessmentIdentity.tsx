'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Context = {
  user: { name: string; role: 'DOCTOR' | 'PATIENT' } | null;
  guest: { name?: string; email?: string } | null;
  invitation: { doctor: { name: string }; assessmentType: string } | null;
};

export default function AssessmentIdentity({ compact = false }: { compact?: boolean }) {
  const [context, setContext] = useState<Context | null>(null);
  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' }).then((response) => response.ok ? response.json() : null).then(setContext).catch(() => undefined);
  }, []);
  if (!context) return null;
  const portal = context.user?.role === 'DOCTOR' ? '/doctor' : '/account';
  const displayName = context.user?.name ?? context.guest?.name ?? 'Invited patient';
  return <div className={`flex items-center gap-2 text-xs text-slate-400 ${compact ? '' : 'rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-2'}`}>
    <span>{displayName}</span>
    {context.invitation && <><span className="text-slate-600">·</span><span>Referred by Dr {context.invitation.doctor.name}</span></>}
    {context.user && <><span className="text-slate-600">·</span><Link href={portal} className="text-blue-400 hover:text-blue-300">My portal</Link></>}
  </div>;
}
