import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import ResultsPrintLayout from './ResultsPrintLayout';

export default async function PrintPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

  const run = await prisma.neurologicalRun.findUnique({
    where: { id: runId },
    include: {
      session: {
        select: {
          id: true,
          meanErrorPx: true,
          calibrationGazeSamples: true,
          config: true,
          testRun: {
            select: { trajectories: true }
          },
          demographics: true,
          createdAt: true,
        },
      },
    },
  });

  if (!run || !run.session) return notFound();

  // Build trajectories from multiple possible sources (same logic as /results/[runId])
  const rawTrajectories = run.session.testRun?.trajectories
    ?? (run.configSnapshot && typeof run.configSnapshot === 'object' && 'testTrajectories' in run.configSnapshot
        ? (run.configSnapshot as Record<string, unknown>).testTrajectories
        : null)
    ?? (run.session.config && typeof run.session.config === 'object' && 'testTrajectories' in run.session.config
        ? (run.session.config as Record<string, unknown>).testTrajectories
        : null)
    ?? null;

  const trajectories: unknown[] | null = Array.isArray(rawTrajectories) ? rawTrajectories : null;

  const testResults = (run.testResults as Record<string, Record<string, unknown>> | null) ?? {};

  const printData = {
    id: run.id,
    status: run.status,
    createdAt: run.createdAt.toISOString(),
    testOrderSnapshot: (run.testOrderSnapshot as string[] | null) ?? [],
    configSnapshot: (run.configSnapshot as Record<string, unknown> | null) ?? {},
    preSymptomScores: (run.preSymptomScores as Record<string, number> | null) ?? null,
    postSymptomScores: (run.postSymptomScores as Record<string, number> | null) ?? null,
    chartSmoothing: (run.configSnapshot && typeof run.configSnapshot === 'object' && 'chartSmoothing' in run.configSnapshot
      ? (run.configSnapshot as any).chartSmoothing
      : (run.session.config && typeof run.session.config === 'object' && 'chartSmoothing' in run.session.config
        ? (run.session.config as any).chartSmoothing
        : { method: 'MOVING_AVERAGE', window: 6 })),
    testResults,
    trajectories,
    session: {
      id: run.session.id,
      meanErrorPx: run.session.meanErrorPx,
      demographics: (run.session.demographics as Record<string, unknown> | null) ?? null,
      createdAt: run.session.createdAt?.toISOString() ?? null,
    },
  };

  return (
    <div className="bg-white min-h-screen text-black">
      <ResultsPrintLayout data={printData} />
    </div>
  );
}
