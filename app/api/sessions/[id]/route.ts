/**
 * GET   /api/sessions/[id] — get one session by id
 * PATCH /api/sessions/[id] — update a session in progress
 *
 * The session row now exists from the moment demographics are submitted, well
 * before calibration produces anything, and is patched here at every break —
 * the participant is resting, and it is where a session that never finishes
 * is best given a chance to have already saved something. See POST
 * /api/sessions for the shape the initial row is created with.
 *
 * calibrationGazeSamples and calibrationImageUrls are always sent as the
 * complete, current arrays (built fresh from all samples collected so far),
 * never a delta — so this can plainly overwrite the column each time. A
 * completed session refuses further writes, which is what stops an
 * out-of-order request (a slow break-patch arriving after the final save)
 * from reopening or corrupting a finished record.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  try {
    const session = await prisma.session.findUnique({
      where: { id },
      include: { testRun: true },
    });
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { testRun, ...rest } = session;
    const payload = { ...rest, testTrajectories: testRun?.trajectories ?? undefined };
    return NextResponse.json(payload);
  } catch (e) {
    console.error('[api/sessions/[id]]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  try {
    const body = await request.json().catch(() => ({}));

    return await prisma.$transaction(async (tx) => {
      const existing = await tx.session.findUnique({ where: { id }, select: { status: true } });
      if (!existing) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

      // Once completed, a session is the record of what actually happened
      // during that assessment. A late break-patch or a retried request
      // arriving after the final save must not reopen or overwrite it.
      if (existing.status === 'completed') {
        return NextResponse.json({ error: 'Cannot update a completed session' }, { status: 400 });
      }

      const rawConfig = body.config != null && typeof body.config === 'object'
        ? (body.config as Record<string, unknown>)
        : undefined;
      const testTrajectories = rawConfig && Array.isArray(rawConfig.testTrajectories)
        ? rawConfig.testTrajectories
        : null;
      const cleanConfig = rawConfig
        ? (() => {
            const { testTrajectories: _dt, isTestSession: _ds, ...rest } = rawConfig;
            return Object.keys(rest).length > 0 ? rest : undefined;
          })()
        : undefined;

      const data: Record<string, unknown> = {};
      if (cleanConfig !== undefined) data.config = cleanConfig;
      if (body.demographics !== undefined && typeof body.demographics === 'object') {
        data.demographics = body.demographics;
      }
      if (typeof body.participantEmail === 'string') {
        data.participantEmail = body.participantEmail.trim()
          ? body.participantEmail.trim().toLowerCase()
          : null;
      }
      if (Array.isArray(body.validationErrors)) data.validationErrors = body.validationErrors;
      if (typeof body.meanErrorPx === 'number' || body.meanErrorPx === null) {
        data.meanErrorPx = body.meanErrorPx;
      }
      if (typeof body.status === 'string') data.status = body.status;
      if (typeof body.videoUrl === 'string' || body.videoUrl === null) data.videoUrl = body.videoUrl;
      if (Array.isArray(body.calibrationImageUrls)) data.calibrationImageUrls = body.calibrationImageUrls;
      if (Array.isArray(body.calibrationGazeSamples) || body.calibrationGazeSamples === null) {
        data.calibrationGazeSamples = body.calibrationGazeSamples;
      }
      if (body.calibrationMeta != null && typeof body.calibrationMeta === 'object') {
        data.calibrationMeta = body.calibrationMeta;
      }

      await tx.session.update({ where: { id }, data });

      if (testTrajectories && testTrajectories.length > 0) {
        await tx.testRun.upsert({
          where: { sessionId: id },
          create: { sessionId: id, trajectories: testTrajectories },
          update: { trajectories: testTrajectories },
        });
      }

      const final = await tx.session.findUnique({ where: { id }, include: { testRun: true } });
      const { testRun, ...rest } = final!;
      return NextResponse.json({ ...rest, testTrajectories: testRun?.trajectories ?? undefined });
    });
  } catch (e) {
    console.error('[api/sessions/[id] PATCH]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  try {
    const session = await prisma.session.findUnique({ where: { id } });
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await prisma.session.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/sessions/[id] DELETE]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200 });
}
