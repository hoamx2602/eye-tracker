/**
 * /results/[runId] — User-facing results page.
 *
 * Phase 5: Full implementation.
 *   - Server fetches run data, passes to ResultsPageClient
 *   - Sections A–F per mvp-plan.md
 */

import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import ResultsPageClient from './ResultsPageClient';

interface Props {
  params: Promise<{ runId: string }>;
}

export default async function ResultsPage({ params }: Props) {
  const { runId } = await params;

  if (!runId || runId.length < 5) {
    redirect('/');
  }

  let run;
  try {
    run = await prisma.neurologicalRun.findUnique({
      where: { id: runId },
      include: {
        session: {
          select: {
            id: true,
            meanErrorPx: true,
            calibrationGazeSamples: true,
            demographics: true,
            createdAt: true,
          },
        },
      },
    });
  } catch {
    redirect('/');
  }

  if (!run || run.status !== 'completed') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-gray-400 text-lg">No results found for this link.</p>
        <a href="/" className="text-blue-400 hover:text-blue-300 text-sm transition">← Back to homepage</a>
      </div>
    );
  }

  // Strip heavy per-trial gaze samples to keep payload lean
  const testResults = (run.testResults as Record<string, Record<string, unknown>> | null) ?? {};
  const strippedResults: Record<string, Record<string, unknown>> = {};
  for (const [testId, result] of Object.entries(testResults)) {
    const { gazeSamples: _gs, events: _ev, ...rest } = result as Record<string, unknown> & {
      gazeSamples?: unknown;
      events?: unknown;
    };
    strippedResults[testId] = rest as Record<string, unknown>;
  }

  const calibrationGazeSamples = (
    (run.session?.calibrationGazeSamples as unknown[] | null) ?? []
  ).slice(0, 500);

  const runData = {
    id: run.id,
    status: run.status,
    createdAt: run.createdAt.toISOString(),
    testOrderSnapshot: (run.testOrderSnapshot as string[] | null) ?? [],
    configSnapshot: (run.configSnapshot as Record<string, unknown> | null) ?? {},
    preSymptomScores: (run.preSymptomScores as Record<string, number> | null) ?? null,
    postSymptomScores: (run.postSymptomScores as Record<string, number> | null) ?? null,
    testResults: strippedResults,
    session: {
      id: run.session?.id ?? '',
      meanErrorPx: run.session?.meanErrorPx ?? null,
      demographics: (run.session?.demographics as Record<string, unknown> | null) ?? null,
      createdAt: run.session?.createdAt?.toISOString() ?? null,
      calibrationGazeSamples,
    },
  };

  return <ResultsPageClient runData={runData} />;
}
