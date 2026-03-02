/**
 * GET /api/sessions/[id] — get one session by id
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

export async function OPTIONS() {
  return new NextResponse(null, { status: 200 });
}
