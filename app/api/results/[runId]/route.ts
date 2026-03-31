/**
 * GET /api/results/[runId] — public endpoint for user-facing results page.
 *
 * No authentication required — runId acts as an access token.
 * Returns:
 *   - run status, test results, pre/post symptom scores
 *   - session: meanErrorPx, calibrationGazeSamples, demographics
 *   - configSnapshot (for scoring baselines)
 *
 * Only returns data for runs with status = "completed".
 * Raw sensitive data (gazeSamples per trial) is stripped — admin API has full data.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;

    if (!runId || runId.length < 5) {
      return NextResponse.json({ error: 'Invalid run ID' }, { status: 400 });
    }

    const run = await prisma.neurologicalRun.findUnique({
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

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (run.status !== 'completed') {
      return NextResponse.json({ error: 'Results not yet available', status: run.status }, { status: 404 });
    }

    // Strip per-trial gaze samples from testResults to keep payload lean.
    // The results page uses only metrics, not raw gaze arrays.
    const testResults = run.testResults as Record<string, Record<string, unknown>> | null;
    const strippedResults: Record<string, Record<string, unknown>> = {};
    if (testResults) {
      for (const [testId, result] of Object.entries(testResults)) {
        // Keep everything except high-volume gazeSamples arrays inside individual test results
        const { gazeSamples: _gs, events: _ev, ...rest } = result as Record<string, unknown> & { gazeSamples?: unknown; events?: unknown };
        strippedResults[testId] = rest as Record<string, unknown>;
      }
    }

    // Keep calibration gaze samples for the visualisation (Section B2), but limit to 500 points
    const rawCalibration = run.session?.calibrationGazeSamples as unknown[] | null;
    const calibrationGazeSamples = rawCalibration ? rawCalibration.slice(0, 500) : null;

    return NextResponse.json({
      id: run.id,
      status: run.status,
      createdAt: run.createdAt,
      testOrderSnapshot: run.testOrderSnapshot,
      configSnapshot: run.configSnapshot,
      preSymptomScores: run.preSymptomScores,
      postSymptomScores: run.postSymptomScores,
      testResults: strippedResults,
      session: {
        id: run.session?.id,
        meanErrorPx: run.session?.meanErrorPx,
        demographics: run.session?.demographics,
        createdAt: run.session?.createdAt,
        calibrationGazeSamples,
      },
    });
  } catch (e) {
    console.error('[api/results/[runId] GET]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
