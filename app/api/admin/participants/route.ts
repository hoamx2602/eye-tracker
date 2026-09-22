/**
 * GET /api/admin/participants — one row per participantEmail, most recently
 * active first. Admin auth required.
 *
 * Exists because a participant can now have more than one Session (email is
 * collected at demographics, and nothing stops the same person coming back
 * for another sitting) — this is the index into that history, not a single
 * session's detail. Query: limit (default 50), offset (default 0), q
 * (case-insensitive substring match on the email).
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
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));
    const q = searchParams.get('q')?.trim() || undefined;

    const where = {
      participantEmail: {
        not: null,
        ...(q ? { contains: q, mode: 'insensitive' as const } : {}),
      },
    };

    // groupBy has no cursor pagination, but a research study's participant
    // count is small enough that offset pagination over it is fine.
    const [groups, totalGroups] = await Promise.all([
      prisma.session.groupBy({
        by: ['participantEmail'],
        where,
        _count: { _all: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
        orderBy: { _max: { createdAt: 'desc' } },
        take: limit,
        skip: offset,
      }),
      prisma.session.groupBy({ by: ['participantEmail'], where }).then((g) => g.length),
    ]);

    const emails = groups.map((g) => g.participantEmail as string);
    // How many of each participant's sessions went on to a neurological run —
    // one query for the whole page rather than N+1, keyed back up in JS.
    const sessionsWithRunFlag = emails.length
      ? await prisma.session.findMany({
          where: { participantEmail: { in: emails } },
          select: { participantEmail: true, neurologicalRun: { select: { id: true } } },
        })
      : [];
    const runCountByEmail = new Map<string, number>();
    for (const s of sessionsWithRunFlag) {
      if (!s.participantEmail || !s.neurologicalRun) continue;
      runCountByEmail.set(s.participantEmail, (runCountByEmail.get(s.participantEmail) ?? 0) + 1);
    }

    const participants = groups.map((g) => ({
      email: g.participantEmail as string,
      sessionCount: g._count._all,
      runCount: runCountByEmail.get(g.participantEmail as string) ?? 0,
      firstSeen: g._min.createdAt,
      lastSeen: g._max.createdAt,
    }));

    return NextResponse.json({
      participants,
      total: totalGroups,
      nextOffset: offset + groups.length < totalGroups ? offset + groups.length : null,
    });
  } catch (e) {
    console.error('[api/admin/participants GET]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
