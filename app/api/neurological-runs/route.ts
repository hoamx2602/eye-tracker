/**
 * POST /api/neurological-runs — create a new run (ticket 14).
 * Body: { sessionId }. Server fetches config (default or from DB) and stores snapshot.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getDefaultConfigSnapshot } from '@/lib/neurologicalConfig';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }

    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const existing = await prisma.neurologicalRun.findUnique({
      where: { sessionId },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'This session already has a neurological run' },
        { status: 409 }
      );
    }

    let configSnapshot: { testOrder: string[]; testParameters: Record<string, unknown>; testEnabled: Record<string, boolean> };
    const dbConfig = await prisma.neurologicalTestConfig.findFirst({
      where: { name: 'default' },
    });
    if (dbConfig && dbConfig.testOrder && typeof dbConfig.testOrder === 'object') {
      const order = Array.isArray(dbConfig.testOrder) ? (dbConfig.testOrder as string[]) : [];
      const params = (dbConfig.testParameters as Record<string, unknown>) ?? {};
      const enabled = (dbConfig.testEnabled as Record<string, boolean>) ?? {};
      configSnapshot = { testOrder: order, testParameters: params, testEnabled: enabled };
    } else {
      configSnapshot = getDefaultConfigSnapshot() as { testOrder: string[]; testParameters: Record<string, unknown>; testEnabled: Record<string, boolean> };
    }

    const testOrderSnapshot = configSnapshot.testOrder;

    const run = await prisma.neurologicalRun.create({
      data: {
        sessionId,
        configSnapshot,
        testOrderSnapshot,
        status: 'in_progress',
      },
    });

    return NextResponse.json(
      {
        id: run.id,
        sessionId: run.sessionId,
        configSnapshot: run.configSnapshot,
        testOrderSnapshot: run.testOrderSnapshot,
        preSymptomScores: run.preSymptomScores,
        postSymptomScores: run.postSymptomScores,
        testResults: run.testResults,
        status: run.status,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      },
      { status: 201 }
    );
  } catch (e) {
    console.error('[api/neurological-runs POST]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
