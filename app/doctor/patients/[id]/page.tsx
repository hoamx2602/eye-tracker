import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { currentPortalUser } from '@/lib/current-user';
import { assessmentLabel } from '@/lib/user-auth';

export const dynamic = 'force-dynamic';

export default async function DoctorPatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentPortalUser();
  if (!user) return null;
  const { id } = await params;
  const email = decodeURIComponent(id).trim().toLowerCase();
  const sessions = await prisma.session.findMany({
    where: { doctorId: user.sub, participantEmail: email }, orderBy: { createdAt: 'desc' },
    include: { patient: { select: { name: true, email: true } }, neurologicalRun: { select: { id: true, status: true } } },
  });
  if (!sessions.length) notFound();
  const firstDemographics = sessions.find((session) => session.demographics)?.demographics as Record<string, unknown> | null;
  const patient = sessions[0].patient;
  const patientName = patient?.name ?? (typeof firstDemographics?.name === 'string' ? firstDemographics.name : email);
  const latestDetails = sessions.find((session) => session.demographics)?.demographics as Record<string, unknown> | null;
  return <div className="space-y-7">
    <div><Link href="/doctor/patients" className="text-sm text-blue-400">← Patients</Link><h1 className="mt-3 text-3xl font-bold">{patientName}</h1><p className="text-slate-400">{email}</p></div>
    {latestDetails && <section className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="font-semibold">Latest patient information</h2><dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
      {['age', 'gender', 'country', 'wearsGlasses', 'eyeConditions', 'notes'].map((key) => latestDetails[key] != null && <div key={key}><dt className="capitalize text-slate-500">{key.replace(/([A-Z])/g, ' $1')}</dt><dd className="mt-1 text-slate-200">{Array.isArray(latestDetails[key]) ? (latestDetails[key] as unknown[]).join(', ') : String(latestDetails[key])}</dd></div>)}
    </dl></section>}
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900"><div className="border-b border-slate-800 px-5 py-4"><h2 className="font-semibold">Test history</h2></div><div className="divide-y divide-slate-800">{sessions.map((session) => <Link key={session.id} href={`/doctor/sessions/${session.id}`} className="grid gap-2 px-5 py-4 hover:bg-slate-800/50 sm:grid-cols-4"><span>{assessmentLabel(session.assessmentType)}</span><span className="text-sm text-slate-400">{session.status}</span><span className="text-sm text-slate-400">{session.neurologicalRun ? `Neuro: ${session.neurologicalRun.status}` : '—'}</span><span className="text-sm text-slate-500 sm:text-right">{session.createdAt.toLocaleString()}</span></Link>)}</div></section>
  </div>;
}
