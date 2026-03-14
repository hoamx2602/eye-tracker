/**
 * GET /api/neurological-runs/[id] — get one run.
 * PATCH /api/neurological-runs/[id] — update run (partial; testResults merged by testId).
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function deepMergeTestResults(
  existing: Record<string, unknown> | null,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const out = existing && typeof existing === 'object' ? { ...existing } : {};
  for (const [testId, value] of Object.entries(incoming)) {
    if (value !== undefined && value !== null) {
      out[testId] = value;
    }
  }
  return out;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const run = await prisma.neurologicalRun.findUnique({ where: { id } });
    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }
    return NextResponse.json(run);
  } catch (e) {
    console.error('[api/neurological-runs GET]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const run = await prisma.neurologicalRun.findUnique({ where: { id } });
    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    const update: {
      configSnapshot?: unknown;
      preSymptomScores?: unknown;
      postSymptomScores?: unknown;
      testOrderSnapshot?: unknown;
      testResults?: unknown;
      status?: string;
    } = {};

    if (body.configSnapshot !== undefined) update.configSnapshot = body.configSnapshot;
    if (body.preSymptomScores !== undefined) update.preSymptomScores = body.preSymptomScores;
    if (body.postSymptomScores !== undefined) update.postSymptomScores = body.postSymptomScores;
    if (body.testOrderSnapshot !== undefined) update.testOrderSnapshot = body.testOrderSnapshot;
    if (body.status !== undefined && typeof body.status === 'string') {
      update.status = body.status;
    }

    if (body.testResults !== undefined && body.testResults !== null && typeof body.testResults === 'object') {
      const existing = run.testResults as Record<string, unknown> | null;
      update.testResults = deepMergeTestResults(existing, body.testResults as Record<string, unknown>);
    }

    const updated = await prisma.neurologicalRun.update({
      where: { id },
      data: update,
    });

    return NextResponse.json(updated);
  } catch (e) {
    console.error('[api/neurological-runs PATCH]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
