import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { currentPortalUser } from '@/lib/current-user';
import { assessmentLabel } from '@/lib/user-auth';
import SessionAnalytics, { type TestTrajectorySegment } from '@/components/SessionAnalytics';

export const dynamic = 'force-dynamic';

function display(value: unknown): string {
  if (value == null) return '—';
  if (Array.isArray(value)) return value.map(String).join(', ') || '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default async function DoctorSessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentPortalUser();
  if (!user) return null;
  const { id } = await params;
  const session = await prisma.session.findFirst({
    where: { id, doctorId: user.sub },
    include: {
      patient: { select: { id: true, name: true, email: true } },
      invitation: { select: { code: true, note: true } },
      neurologicalRun: { select: { id: true, status: true, createdAt: true, testResults: true, preSymptomScores: true, postSymptomScores: true } },
      testRun: { select: { id: true, trajectories: true } },
    },
  });
  if (!session) notFound();
  const demographics = session.demographics as Record<string, unknown> | null;
  const config = session.config as Record<string, unknown> | null;
  const samples = Array.isArray(session.calibrationGazeSamples)
    ? session.calibrationGazeSamples as Array<{ screenX?: number; screenY?: number; features?: number[]; timestamp?: number; head?: { valid: boolean; message: string; faceWidth?: number } }>
    : [];
  const trajectories = Array.isArray(session.testRun?.trajectories)
    ? session.testRun.trajectories as unknown as TestTrajectorySegment[]
    : null;
  const fields = demographics ? Object.entries(demographics).filter(([key]) => key !== 'email') : [];
  const neuroTestCount = session.neurologicalRun?.testResults && typeof session.neurologicalRun.testResults === 'object'
    ? Object.keys(session.neurologicalRun.testResults as Record<string, unknown>).length : 0;
  return <div className="space-y-7">
    <div><Link href="/doctor/sessions" className="text-sm text-blue-400">← Test results</Link><div className="mt-3 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-bold">{assessmentLabel(session.assessmentType)}</h1><p className="mt-1 font-mono text-xs text-slate-500">{session.id}</p></div><span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-sm text-slate-300">{session.status ?? 'Unknown'}</span></div></div>
    <div className="grid gap-4 md:grid-cols-3">{[
      ['Patient', session.patient?.name ?? session.participantEmail ?? 'Unknown'],
      ['Created', session.createdAt.toLocaleString()],
      ['Mean calibration error', session.meanErrorPx != null ? `${session.meanErrorPx.toFixed(2)} px` : '—'],
      ['Doctor link code', session.invitation?.code ?? 'Direct assessment'],
      ['Neurological tests', session.neurologicalRun ? `${neuroTestCount} saved · ${session.neurologicalRun.status}` : '—'],
      ['Recording', session.videoUrl ? 'Available' : 'Not saved'],
    ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-800 bg-slate-900 p-5"><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-slate-200">{value}</p></div>)}</div>
    {session.participantEmail && <Link href={`/doctor/patients/${encodeURIComponent(session.participantEmail)}`} className="inline-flex text-sm text-blue-400">Open complete patient history →</Link>}
    {fields.length > 0 && <section className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="font-semibold">Patient information at time of test</h2><dl className="mt-4 grid gap-4 sm:grid-cols-3">{fields.map(([key, value]) => <div key={key}><dt className="text-xs capitalize text-slate-500">{key.replace(/([A-Z])/g, ' $1')}</dt><dd className="mt-1 text-sm text-slate-200">{display(value)}</dd></div>)}</dl></section>}
    {samples.length > 0 && <section className="space-y-3"><h2 className="font-semibold">Calibration and gaze analysis</h2><SessionAnalytics samples={samples} validationErrors={session.validationErrors} meanErrorPx={session.meanErrorPx} faceDistanceCm={typeof config?.faceDistance === 'number' ? config.faceDistance : undefined} testTrajectories={trajectories} /></section>}
    {session.assessmentType === 'IOP' && config?.results != null && <section className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="font-semibold">IOP research measurements</h2><pre className="mt-4 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-300">{JSON.stringify(config.results, null, 2)}</pre></section>}
    {session.assessmentType === 'FACIAL_DROOP' && config?.report != null && <section className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="font-semibold">Facial movement and speech report</h2><pre className="mt-4 max-h-[36rem] overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-300">{JSON.stringify(config.report, null, 2)}</pre></section>}
    {session.neurologicalRun && <section className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="font-semibold">Neurological run</h2><p className="mt-2 text-sm text-slate-400">{neuroTestCount} individual test result{neuroTestCount === 1 ? '' : 's'} recorded.</p><Link href={`/results/${session.neurologicalRun.id}`} className="mt-4 inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500">Open full results</Link></section>}
  </div>;
}
