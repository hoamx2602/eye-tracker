/**
 * GET /api/neurological-runs/[id] — get one run.
 * PATCH /api/neurological-runs/[id] — update run (partial; testResults merged by testId).
 */
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
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
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));

    // Start a transaction to ensure atomicity
    return await prisma.$transaction(async (tx) => {
      const run = await tx.neurologicalRun.findUnique({ 
        where: { id },
        select: { status: true } 
      });

      if (!run) {
        return NextResponse.json({ error: 'Run not found' }, { status: 404 });
      }

      // Safeguard: Prevent updates to completed or abandoned runs
      // (Except for certain status transitions if needed, but here we enforce finality)
      if (run.status === 'completed' || run.status === 'abandoned') {
        return NextResponse.json({ error: `Cannot update a ${run.status} run` }, { status: 400 });
      }

      const updateData: any = {};
      if (body.status !== undefined) updateData.status = body.status;
      if (body.configSnapshot !== undefined) updateData.configSnapshot = body.configSnapshot;
      if (body.preSymptomScores !== undefined) updateData.preSymptomScores = body.preSymptomScores;
      if (body.postSymptomScores !== undefined) updateData.postSymptomScores = body.postSymptomScores;
      if (body.testOrderSnapshot !== undefined) updateData.testOrderSnapshot = body.testOrderSnapshot;

      // Update standard fields
      await tx.neurologicalRun.update({
        where: { id },
        data: updateData
      });

      // Atomic merge for testResults using PostgreSQL JSONB concatenation
      if (body.testResults && typeof body.testResults === 'object') {
        const incomingJson = JSON.stringify(body.testResults);
        // Using raw query for atomic JSONB merge (|| operator)
        // This prevents race conditions where concurrent PATCHes overwrite each other's keys
        await tx.$executeRaw`
          UPDATE "NeurologicalRun"
          SET "testResults" = COALESCE("testResults", '{}'::jsonb) || ${incomingJson}::jsonb,
              "updatedAt" = NOW()
          WHERE "id" = ${id}
        `;
      }

      const finalRun = await tx.neurologicalRun.findUnique({ where: { id } });
      return NextResponse.json(finalRun);
    });
  } catch (e) {
    console.error('[api/neurological-runs PATCH]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
