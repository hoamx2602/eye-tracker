import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { currentPortalUser } from '@/lib/current-user';
import { assessmentLabel } from '@/lib/user-auth';

export const dynamic = 'force-dynamic';

export default async function DoctorSessionsPage() {
  const user = await currentPortalUser();
  if (!user) return null;
  const sessions = await prisma.session.findMany({
    where: { doctorId: user.sub }, orderBy: { createdAt: 'desc' },
    include: { patient: { select: { name: true, email: true } } }, take: 200,
  });
  return <div className="space-y-6"><div><h1 className="text-3xl font-bold">Test results</h1><p className="mt-1 text-slate-400">All assessment sessions linked to your account.</p></div>
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">{sessions.length === 0 ? <p className="p-8 text-center text-slate-500">No tests yet.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-slate-800 text-xs uppercase text-slate-500"><th className="px-4 py-3">Patient</th><th className="px-4 py-3">Assessment</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Date</th><th className="px-4 py-3"></th></tr></thead><tbody className="divide-y divide-slate-800">{sessions.map((session) => <tr key={session.id}><td className="px-4 py-3"><p className="font-medium text-white">{session.patient?.name ?? 'Patient'}</p><p className="text-xs text-slate-500">{session.patient?.email ?? session.participantEmail ?? '—'}</p></td><td className="px-4 py-3 text-slate-300">{assessmentLabel(session.assessmentType)}</td><td className="px-4 py-3 text-slate-300">{session.status ?? '—'}</td><td className="px-4 py-3 text-slate-400">{session.createdAt.toLocaleString()}</td><td className="px-4 py-3 text-right"><Link href={`/doctor/sessions/${session.id}`} className="text-blue-400 hover:text-blue-300">View</Link></td></tr>)}</tbody></table></div>}</div>
  </div>;
}
