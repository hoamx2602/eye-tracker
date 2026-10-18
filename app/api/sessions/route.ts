/**
 * GET  /api/sessions — list sessions (query: limit, cursor). Admin auth required —
 * this is the one route that hands back every participant's email and data at
 * once rather than a single record a caller already has the id for, so it is
 * gated the same way the rest of the admin surface is.
 * POST /api/sessions — create session (participant-facing, stays public)
 */
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAdminCookieName, verifyAdminToken } from '@/lib/admin-auth';
import { FACIAL_SPEECH_STATUSES } from '@/lib/facialSpeechArchive';
import { invitationAccessFromRequest, userFromRequest } from '@/lib/request-auth';
import { getSessionCookieName, getSessionCookieOptions, signSessionAccessToken } from '@/lib/user-auth';

async function requireAdmin(request: NextRequest) {
  const cookieName = getAdminCookieName();
  const token = request.cookies.get(cookieName)?.value;
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const payload = await verifyAdminToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  return null;
}

/**
 * Facial-speech captures are Sessions too, but they carry no calibration or
 * gaze data, so they get their own admin tab and are kept out of the
 * calibration list rather than filling it with rows of empty columns.
 *
 * Matched on `status`, not on a JSON path: `config` is nullable and so are its
 * keys, and in SQL a negated comparison against NULL is NULL, which would
 * silently drop every session whose config predates this field.
 */
const FACIAL_SPEECH_WHERE = { status: { in: FACIAL_SPEECH_STATUSES } };
const NOT_FACIAL_SPEECH_WHERE = {
  OR: [{ status: null }, { status: { notIn: FACIAL_SPEECH_STATUSES } }],
};

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const cursor = searchParams.get('cursor') || undefined;
    const testOnly = searchParams.get('testOnly') === '1';
    const facialSpeechOnly = searchParams.get('protocol') === 'facial-speech';

    const where = facialSpeechOnly
      ? FACIAL_SPEECH_WHERE
      : testOnly
        ? { testRun: { isNot: null } }
        : { testRun: null, ...NOT_FACIAL_SPEECH_WHERE };

    const sessions = await prisma.session.findMany({
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      where,
      include: {
        testRun: testOnly,
        doctor: { select: { id: true, name: true, email: true } },
        patient: { select: { id: true, name: true, email: true } },
      },
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
    const portalUser = await userFromRequest(request);
    const inviteAccess = await invitationAccessFromRequest(request);
    if (!portalUser && !inviteAccess) {
      return NextResponse.json({ error: 'Authentication or a valid invitation is required' }, { status: 401 });
    }
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
      assessmentType,
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

    const normalizedAssessment = ['EYE_TRACKING', 'FACIAL_DROOP', 'IOP'].includes(assessmentType)
      ? assessmentType
      : 'EYE_TRACKING';
    const inviteCode = inviteAccess?.code;
    const storedDemographics = demographics != null && typeof demographics === 'object'
      ? demographics as Prisma.InputJsonObject
      : undefined;
    const demographicsEmail = typeof storedDemographics?.email === 'string'
      ? storedDemographics.email.trim().toLowerCase()
      : '';

    const session = await prisma.$transaction(async (tx) => {
      let invitation: { id: string; doctorId: string } | null = null;
      if (inviteCode) {
        const candidate = await tx.testInvitation.findUnique({ where: { code: inviteCode } });
        const valid = candidate && candidate.active && candidate.assessmentType === normalizedAssessment &&
          candidate.usedCount < candidate.maxUses && (!candidate.expiresAt || candidate.expiresAt > new Date());
        if (valid) invitation = { id: candidate.id, doctorId: candidate.doctorId };
      }
      if (!portalUser && !invitation) throw new Error('INVITATION_UNAVAILABLE');

      const created = await tx.session.create({
        data: {
          config: config ?? undefined,
          demographics: storedDemographics,
        // Normalised so the same participant is one value across sessions.
        participantEmail:
          portalUser?.role === 'PATIENT'
            ? portalUser.email
            : typeof participantEmail === 'string' && participantEmail.trim()
              ? participantEmail.trim().toLowerCase()
              : demographicsEmail || null,
        assessmentType: normalizedAssessment,
        patientId: portalUser?.role === 'PATIENT' ? portalUser.sub : null,
        doctorId: invitation?.doctorId ?? (portalUser?.role === 'DOCTOR' ? portalUser.sub : null),
        invitationId: invitation?.id ?? null,
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

      if (invitation) {
        await tx.testInvitation.update({ where: { id: invitation.id }, data: { usedCount: { increment: 1 } } });
      }
      if (testTrajectories && testTrajectories.length > 0) {
        await tx.testRun.create({ data: { sessionId: created.id, trajectories: testTrajectories } });
      }
      return created;
    });

    const response = NextResponse.json(session, { status: 201 });
    response.cookies.set(
      getSessionCookieName(),
      await signSessionAccessToken({ sessionId: session.id }),
      getSessionCookieOptions(),
    );
    return response;
  } catch (e) {
    console.error('[api/sessions]', e);
    if (e instanceof Error && e.message === 'INVITATION_UNAVAILABLE') {
      return NextResponse.json({ error: 'This test invitation is no longer available.' }, { status: 410 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200 });
}
