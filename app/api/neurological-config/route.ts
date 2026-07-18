/**
 * GET /api/neurological-config — public read of default config (for run creation with latest params).
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { applyQuickMode, getDefaultConfigSnapshot, isQuickModeEnv, quickTestOrder } from '@/lib/neurologicalConfig';

export async function GET() {
  try {
    const quick = isQuickModeEnv();
    const row = await prisma.neurologicalTestConfig.findUnique({
      where: { name: 'default' },
    });

    if (!row) {
      const defaultSnap = getDefaultConfigSnapshot();
      const testParameters = quick
        ? applyQuickMode(defaultSnap.testParameters as Record<string, Record<string, unknown>>)
        : defaultSnap.testParameters;
      const testOrder = quick
        ? quickTestOrder(defaultSnap.testOrder as string[], defaultSnap.testEnabled)
        : defaultSnap.testOrder;
      console.log('[api/neurological-config GET] source=default quickMode=%s testOrder=', quick, testOrder);
      return NextResponse.json(
        {
          testOrder,
          testParameters,
          testEnabled: defaultSnap.testEnabled,
          _source: quick ? 'default+quick' : 'default',
          _quickMode: quick,
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    let testOrder = (Array.isArray(row.testOrder) ? row.testOrder : (row.testOrder as unknown)) as string[];
    let testParameters = (row.testParameters as Record<string, unknown>) ?? {};
    const testEnabled = (row.testEnabled as Record<string, boolean>) ?? {};
    if (quick) {
      testParameters = applyQuickMode(testParameters as Record<string, Record<string, unknown>>);
      testOrder = quickTestOrder(testOrder as string[], testEnabled);
    }
    console.log('[api/neurological-config GET] source=db quickMode=%s testOrder=', quick, testOrder);

    return NextResponse.json(
      { testOrder, testParameters, testEnabled, _source: quick ? 'db+quick' : 'db', _quickMode: quick },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      }
    );
  } catch (e) {
    console.error('[api/neurological-config GET]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
