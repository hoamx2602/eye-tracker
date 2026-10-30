import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { currentPortalUser } from '@/lib/current-user';
import { assessmentLabel } from '@/lib/user-auth';
import PortalLogoutButton from '@/components/portal/PortalLogoutButton';

export const dynamic = 'force-dynamic';

export default async function PatientAccountPage() {
  const user = await currentPortalUser();
  if (!user) return null;
  const sessions = await prisma.session.findMany({
    where: { patientId: user.sub }, orderBy: { createdAt: 'desc' },
    include: { doctor: { select: { name: true } }, neurologicalRun: { select: { id: true, status: true } } },
  });
  return <div className="min-h-screen bg-slate-950 text-slate-100">
    <header className="border-b border-slate-800 bg-slate-900"><div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5"><Link href="/" className="font-bold">Neurotree</Link><div className="flex items-center gap-4"><span className="text-sm text-slate-400">{user.name}</span><PortalLogoutButton /></div></div></header>
    <main className="mx-auto max-w-5xl space-y-7 px-5 py-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-bold">Your assessments</h1><p className="mt-1 text-slate-400">Your test history and referring clinician.</p></div><Link href="/" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500">Choose an assessment</Link></div>
      <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">{sessions.length === 0 ? <div className="p-9 text-center"><p className="text-slate-400">You have no saved assessments yet.</p><Link href="/" className="mt-3 inline-flex text-blue-400">Start an assessment</Link></div> : <div className="divide-y divide-slate-800">{sessions.map((session) => <div key={session.id} className="grid gap-2 px-5 py-4 sm:grid-cols-4"><span className="font-medium">{assessmentLabel(session.assessmentType)}</span><span className="text-sm text-slate-400">{session.doctor ? `Dr ${session.doctor.name}` : 'No referring doctor'}</span><span className="text-sm text-slate-400">{session.status ?? '—'}</span><span className="text-sm text-slate-500 sm:text-right">{session.createdAt.toLocaleString()}</span>{session.neurologicalRun?.status === 'completed' && <Link href={`/results/${session.neurologicalRun.id}`} className="text-sm text-blue-400 sm:col-span-4">View neurological results →</Link>}</div>)}</div>}</section>
    </main>
  </div>;
}
