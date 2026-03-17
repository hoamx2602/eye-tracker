/**
 * GET /api/app-config — public read of default app config (calibration, smoothing, recording).
 * Used by the app on load. Returns DB-stored config or DEFAULT_CONFIG.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { DEFAULT_CONFIG } from '@/types';

export async function GET() {
  try {
    const row = await prisma.appConfig.findUnique({
      where: { name: 'default' },
    });

    if (!row || !row.config || typeof row.config !== 'object') {
      return NextResponse.json(DEFAULT_CONFIG);
    }

    const merged = { ...DEFAULT_CONFIG, ...(row.config as object) };
    return NextResponse.json(merged);
  } catch (e) {
    console.error('[api/app-config GET]', e);
    return NextResponse.json(DEFAULT_CONFIG);
  }
}
