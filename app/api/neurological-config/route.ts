/**
 * GET /api/neurological-config — public read of default config (for run creation with latest params).
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { applyQuickMode, getDefaultConfigSnapshot, isQuickModeEnv } from '@/lib/neurologicalConfig';

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
      console.log('[api/neurological-config GET] source=default quickMode=%s memory_cards=', quick, (testParameters as any)?.memory_cards);
      return NextResponse.json(
        {
          testOrder: defaultSnap.testOrder,
          testParameters,
          testEnabled: defaultSnap.testEnabled,
          _source: quick ? 'default+quick' : 'default',
          _quickMode: quick,
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const testOrder = Array.isArray(row.testOrder) ? row.testOrder : (row.testOrder as unknown) as string[];
    let testParameters = (row.testParameters as Record<string, unknown>) ?? {};
    const testEnabled = (row.testEnabled as Record<string, boolean>) ?? {};
    if (quick) testParameters = applyQuickMode(testParameters as Record<string, Record<string, unknown>>);
    console.log('[api/neurological-config GET] source=db quickMode=%s updatedAt=', quick, row.updatedAt?.toISOString?.(), 'memory_cards=', (testParameters as any)?.memory_cards);

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
