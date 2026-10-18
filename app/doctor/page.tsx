import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { currentPortalUser } from '@/lib/current-user';
import { assessmentLabel } from '@/lib/user-auth';

export const dynamic = 'force-dynamic';

export default async function DoctorDashboardPage() {
  const user = await currentPortalUser();
  if (!user) return null;
  const [sessionCount, patientGroups, activeLinks, recent] = await Promise.all([
    prisma.session.count({ where: { doctorId: user.sub } }),
    prisma.session.groupBy({ by: ['participantEmail'], where: { doctorId: user.sub, participantEmail: { not: null } } }),
    prisma.testInvitation.count({
      where: { doctorId: user.sub, active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    }),
    prisma.session.findMany({
      where: { doctorId: user.sub },
      take: 8,
      orderBy: { createdAt: 'desc' },
      include: { patient: { select: { name: true, email: true } } },
    }),
  ]);
  const cards = [
    { label: 'Patients', value: patientGroups.length, href: '/doctor/patients' },
    { label: 'Test sessions', value: sessionCount, href: '/doctor/sessions' },
    { label: 'Active test links', value: activeLinks, href: '/doctor/invitations' },
  ];
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-3xl font-bold">Clinical dashboard</h1><p className="mt-1 text-slate-400">Only patients and tests assigned to your account are shown.</p></div>
        <Link href="/doctor/invitations" className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold hover:bg-blue-500">Create test link</Link>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((card) => <Link key={card.label} href={card.href} className="rounded-xl border border-slate-800 bg-slate-900 p-5 hover:border-slate-600">
          <p className="text-sm text-slate-400">{card.label}</p><p className="mt-2 text-3xl font-bold">{card.value}</p>
        </Link>)}
      </div>
      <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4"><h2 className="font-semibold">Recent tests</h2><Link href="/doctor/sessions" className="text-sm text-blue-400">View all</Link></div>
        {recent.length === 0 ? <p className="p-8 text-center text-slate-500">No patient tests yet.</p> : (
          <div className="divide-y divide-slate-800">{recent.map((session) => <Link key={session.id} href={`/doctor/sessions/${session.id}`} className="grid gap-2 px-5 py-4 hover:bg-slate-800/50 sm:grid-cols-4">
            <span className="font-medium">{session.patient?.name ?? session.participantEmail ?? 'Patient'}</span>
            <span className="text-sm text-slate-400">{assessmentLabel(session.assessmentType)}</span>
            <span className="text-sm text-slate-400">{session.status ?? '—'}</span>
            <span className="text-sm text-slate-500 sm:text-right">{session.createdAt.toLocaleString()}</span>
          </Link>)}</div>
        )}
      </section>
    </div>
  );
}
