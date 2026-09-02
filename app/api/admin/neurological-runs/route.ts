/**
 * GET /api/admin/neurological-runs — list runs with pagination (ticket 14, optional scale).
 * Query: limit (default 50), cursor (run id). Admin auth required.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminCookieName, verifyAdminToken } from '@/lib/admin-auth';
import { prisma } from '@/lib/prisma';

async function requireAdmin(request: NextRequest) {
  const cookieName = getAdminCookieName();
  const token = request.cookies.get(cookieName)?.value;
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const payload = await verifyAdminToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  return null;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '50', 10)), 100);
    const cursor = searchParams.get('cursor') || undefined;

    const runs = await prisma.neurologicalRun.findMany({
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        sessionId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        preSymptomScores: true,
        postSymptomScores: true,
        testOrderSnapshot: true,
        testResults: true,
      },
    });

    const hasMore = runs.length > limit;
    const list = hasMore ? runs.slice(0, limit) : runs;
    const nextCursor = hasMore ? list[list.length - 1].id : null;

    return NextResponse.json({
      runs: list,
      nextCursor,
    });
  } catch (e) {
    console.error('[api/admin/neurological-runs GET]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
