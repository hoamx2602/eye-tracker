/**
 * GET /api/neurological-config — public read of default config (for run creation with latest params).
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getDefaultConfigSnapshot } from '@/lib/neurologicalConfig';

export async function GET() {
  try {
    const row = await prisma.neurologicalTestConfig.findUnique({
      where: { name: 'default' },
    });

    if (!row) {
      const defaultSnap = getDefaultConfigSnapshot();
      return NextResponse.json(
        {
          testOrder: defaultSnap.testOrder,
          testParameters: defaultSnap.testParameters,
          testEnabled: defaultSnap.testEnabled,
          _source: 'default',
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const testOrder = Array.isArray(row.testOrder) ? row.testOrder : (row.testOrder as unknown) as string[];
    const testParameters = (row.testParameters as Record<string, unknown>) ?? {};
    const testEnabled = (row.testEnabled as Record<string, boolean>) ?? {};

    return NextResponse.json(
      { testOrder, testParameters, testEnabled, _source: 'db' },
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
