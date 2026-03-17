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
    let configSnapshot: { testOrder: string[]; testParameters: Record<string, unknown>; testEnabled: Record<string, boolean> };
    const bodySnapshot = body.configSnapshot;
    if (
      bodySnapshot &&
      typeof bodySnapshot === 'object' &&
      Array.isArray(bodySnapshot.testOrder) &&
      typeof bodySnapshot.testParameters === 'object' &&
      bodySnapshot.testParameters !== null &&
      typeof bodySnapshot.testEnabled === 'object' &&
      bodySnapshot.testEnabled !== null
    ) {
      console.log('[api/neurological-runs POST] source=body sessionId=', sessionId, 'existingRun=', Boolean(existing));
      configSnapshot = {
        testOrder: bodySnapshot.testOrder as string[],
        testParameters: bodySnapshot.testParameters as Record<string, unknown>,
        testEnabled: bodySnapshot.testEnabled as Record<string, boolean>,
      };
    } else {
      const dbConfig = await prisma.neurologicalTestConfig.findFirst({
        where: { name: 'default' },
      });
      if (dbConfig && dbConfig.testOrder && typeof dbConfig.testOrder === 'object') {
        console.log('[api/neurological-runs POST] source=db sessionId=', sessionId, 'existingRun=', Boolean(existing), 'dbConfig.updatedAt=', dbConfig.updatedAt?.toISOString?.());
        const order = Array.isArray(dbConfig.testOrder) ? (dbConfig.testOrder as string[]) : [];
        const params = (dbConfig.testParameters as Record<string, unknown>) ?? {};
        const enabled = (dbConfig.testEnabled as Record<string, boolean>) ?? {};
        configSnapshot = { testOrder: order, testParameters: params, testEnabled: enabled };
      } else {
        console.log('[api/neurological-runs POST] source=default sessionId=', sessionId, 'existingRun=', Boolean(existing));
        configSnapshot = getDefaultConfigSnapshot() as { testOrder: string[]; testParameters: Record<string, unknown>; testEnabled: Record<string, boolean> };
      }
    }

    const testOrderSnapshot = configSnapshot.testOrder;
    console.log('[api/neurological-runs POST] snapshot memory_cards=', (configSnapshot.testParameters as any)?.memory_cards);

    // If a run already exists for this session, refresh its snapshot so latest admin config applies.
    // This is especially helpful during iterative tuning/testing.
    const run = existing
      ? await prisma.neurologicalRun.update({
          where: { id: existing.id },
          data: {
            configSnapshot,
            testOrderSnapshot,
          },
        })
      : await prisma.neurologicalRun.create({
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
      { status: existing ? 200 : 201 }
    );
  } catch (e) {
    console.error('[api/neurological-runs POST]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
