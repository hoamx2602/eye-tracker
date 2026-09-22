/**
 * GET  /api/sessions — list sessions (query: limit, cursor). Admin auth required —
 * this is the one route that hands back every participant's email and data at
 * once rather than a single record a caller already has the id for, so it is
 * gated the same way the rest of the admin surface is.
 * POST /api/sessions — create session (participant-facing, stays public)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAdminCookieName, verifyAdminToken } from '@/lib/admin-auth';

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
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const cursor = searchParams.get('cursor') || undefined;
    const testOnly = searchParams.get('testOnly') === '1';

    const sessions = await prisma.session.findMany({
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      where: testOnly ? { testRun: { isNot: null } } : { testRun: null },
      include: { testRun: testOnly },
    });
    const hasMore = sessions.length > limit;
    const list = hasMore ? sessions.slice(0, limit) : sessions;
    const nextCursor = hasMore ? list[list.length - 1].id : null;
    const sessionsForClient = list.map((s) => {
      const { testRun, ...rest } = s;
      const tr = testRun
        ? { id: testRun.id, segmentCount: Array.isArray(testRun.trajectories) ? testRun.trajectories.length : 0 }
        : null;
      return { ...rest, testRun: tr };
    });
    return NextResponse.json({ sessions: sessionsForClient, nextCursor });
  } catch (e) {
    console.error('[api/sessions]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let {
      config,
      demographics,
      validationErrors,
      meanErrorPx,
      status,
      videoUrl,
      calibrationImageUrls,
      calibrationGazeSamples,
      calibrationMeta,
      participantEmail,
    } = body;

    // Store test trajectories in TestRun table, not in config
    const rawConfig = config != null && typeof config === 'object' ? config as Record<string, unknown> : {};
    const testTrajectories = Array.isArray(rawConfig.testTrajectories) ? rawConfig.testTrajectories : null;
    const { testTrajectories: _dt, isTestSession: _ds, ...cleanConfig } = rawConfig;
    config = Object.keys(cleanConfig).length > 0 ? cleanConfig : undefined;

    const sampleCount = Array.isArray(calibrationGazeSamples) ? calibrationGazeSamples.length : 0;
    const imageUrlCount = Array.isArray(calibrationImageUrls) ? calibrationImageUrls.length : 0;
    if (process.env.NODE_ENV === 'development') {
      console.log('[api/sessions POST] Received:', { sampleCount, imageUrlCount, hasVideo: Boolean(videoUrl), hasTestRun: Boolean(testTrajectories?.length) });
    }

    const session = await prisma.session.create({
      data: {
        config: config ?? undefined,
        demographics: demographics != null && typeof demographics === 'object' ? demographics : undefined,
        // Normalised so the same participant is one value across sessions.
        participantEmail:
          typeof participantEmail === 'string' && participantEmail.trim()
            ? participantEmail.trim().toLowerCase()
            : null,
        validationErrors: Array.isArray(validationErrors) ? validationErrors : [],
        meanErrorPx: typeof meanErrorPx === 'number' ? meanErrorPx : null,
        // Created early (right after demographics, before calibration starts)
        // this is 'in_progress' by default; the caller sets 'completed'
        // explicitly once calibration actually finishes.
        status: typeof status === 'string' ? status : 'in_progress',
        videoUrl: typeof videoUrl === 'string' ? videoUrl : null,
        calibrationImageUrls: Array.isArray(calibrationImageUrls) ? calibrationImageUrls : undefined,
        calibrationGazeSamples:
          Array.isArray(calibrationGazeSamples) || calibrationGazeSamples === null
            ? calibrationGazeSamples
            : undefined,
        calibrationMeta:
          calibrationMeta != null && typeof calibrationMeta === 'object' ? calibrationMeta : undefined,
      },
    });

    if (testTrajectories && testTrajectories.length > 0) {
      await prisma.testRun.create({
        data: { sessionId: session.id, trajectories: testTrajectories },
      });
    }

    return NextResponse.json(session, { status: 201 });
  } catch (e) {
    console.error('[api/sessions]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200 });
}
