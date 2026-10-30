import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { currentPortalUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

export default async function DoctorPatientsPage() {
  const user = await currentPortalUser();
  if (!user) return null;
  const sessions = await prisma.session.findMany({
    where: { doctorId: user.sub, participantEmail: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { participantEmail: true, createdAt: true, demographics: true, patient: { select: { name: true, email: true } } },
  });
  const rows = new Map<string, { name: string; email: string; count: number; latest: Date }>();
  for (const session of sessions) {
    if (!session.participantEmail) continue;
    const demographics = session.demographics && typeof session.demographics === 'object' && !Array.isArray(session.demographics)
      ? session.demographics as Record<string, unknown> : null;
    const patientName = session.patient?.name ?? (typeof demographics?.name === 'string' ? demographics.name : session.participantEmail);
    const row = rows.get(session.participantEmail);
    if (row) row.count += 1;
    else rows.set(session.participantEmail, { name: patientName, email: session.participantEmail, count: 1, latest: session.createdAt });
  }
  return <div className="space-y-6"><div><h1 className="text-3xl font-bold">Patients</h1><p className="mt-1 text-slate-400">Patient records created from your test links.</p></div>
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">{rows.size === 0 ? <p className="p-8 text-center text-slate-500">No linked patients yet.</p> : <div className="divide-y divide-slate-800">{Array.from(rows.values()).map((row) => <Link key={row.email} href={`/doctor/patients/${encodeURIComponent(row.email)}`} className="grid items-center gap-2 px-5 py-4 hover:bg-slate-800/50 sm:grid-cols-4"><span className="font-medium text-white">{row.name}</span><span className="text-sm text-slate-400">{row.email}</span><span className="text-sm text-slate-400">{row.count} test{row.count === 1 ? '' : 's'}</span><span className="text-sm text-slate-500 sm:text-right">Last: {row.latest.toLocaleString()}</span></Link>)}</div>}</div>
  </div>;
}
