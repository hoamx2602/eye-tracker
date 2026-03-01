/**
 * GET  /api/sessions — list sessions (query: limit, cursor)
 * POST /api/sessions — create session
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const cursor = searchParams.get('cursor') || undefined;

    const sessions = await prisma.session.findMany({
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    });
    const hasMore = sessions.length > limit;
    const list = hasMore ? sessions.slice(0, limit) : sessions;
    const nextCursor = hasMore ? list[list.length - 1].id : null;
    return NextResponse.json({ sessions: list, nextCursor });
  } catch (e) {
    console.error('[api/sessions]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      config,
      validationErrors,
      meanErrorPx,
      status,
      videoUrl,
      calibrationImageUrls,
      calibrationGazeSamples,
    } = body;

    const sampleCount = Array.isArray(calibrationGazeSamples) ? calibrationGazeSamples.length : 0;
    const imageUrlCount = Array.isArray(calibrationImageUrls) ? calibrationImageUrls.length : 0;
    if (process.env.NODE_ENV === 'development') {
      console.log('[api/sessions POST] Received:', { sampleCount, imageUrlCount, hasVideo: Boolean(videoUrl) });
    }

    const session = await prisma.session.create({
      data: {
        config: config ?? undefined,
        validationErrors: Array.isArray(validationErrors) ? validationErrors : [],
        meanErrorPx: typeof meanErrorPx === 'number' ? meanErrorPx : null,
        status: typeof status === 'string' ? status : 'completed',
        videoUrl: typeof videoUrl === 'string' ? videoUrl : null,
        calibrationImageUrls: Array.isArray(calibrationImageUrls) ? calibrationImageUrls : undefined,
        calibrationGazeSamples:
          Array.isArray(calibrationGazeSamples) || calibrationGazeSamples === null
            ? calibrationGazeSamples
            : undefined,
      },
    });
    return NextResponse.json(session, { status: 201 });
  } catch (e) {
    console.error('[api/sessions]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200 });
}
